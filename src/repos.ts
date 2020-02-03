// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {octo, repos} from './util';
import {Flags, Repo} from './types';

/**
 * Iterate over each repository, and set consistent admin settings.
 * Requires a very high access admin account.
 * @param flags CLI options passed directly as flags.
 */
export async function syncRepoSettings(flags: Flags) {
  if (!flags.language && !flags.repo) {
    throw new Error('Either --language or --repo must be set.');
  }

  // Get the list of repositories we want to act on
  const syncRepos = repos.filter(repo => {
    if (repo.language === flags.language) {
      const cfg = languageConfig[repo.language];
      if (!cfg || !cfg.ignoredRepos || !cfg.ignoredRepos.includes(repo.repo)) {
        return true;
      }
    }
    if (repo.repo === flags.repo) {
      return true;
    }
    return false;
  });

  console.log(`Updating settings on ${syncRepos.length} repos...`);

  await updateRepoOptions(syncRepos);
  await updateMasterBranchProtection(syncRepos);
  await updateRepoTeams(syncRepos);
}

/**
 * Enable master branch protection, and required status checks
 * @param repos List of repos to iterate.
 */
async function updateMasterBranchProtection(repos: Repo[]) {
  console.log('Updating master branch protection...');
  for (const repo of repos) {
    const [owner, name] = repo.repo.split('/');
    await octo.repos
      .updateBranchProtection({
        branch: 'master',
        owner,
        repo: name,
        required_pull_request_reviews: {
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
        },
        required_status_checks: {
          contexts: languageConfig[repo.language].requiredStatusChecks,
          strict: true,
        },
        enforce_admins: true,
        restrictions: null!,
      })
      .catch(e => {
        console.error(`Error updating branch protection for ${repo.repo}`);
        console.error(e);
      });
  }
}

/**
 * Ensure the correct teams are added to the repository
 * @param repos List of repos to iterate.
 */
async function updateRepoTeams(repos: Repo[]) {
  console.log(`Update team access...`);
  for (const repo of repos) {
    const [owner, name] = repo.repo.split('/');
    const teamsToAdd = [
      {
        slug: 'yoshi-admins',
        permission: 'admin',
      },
      {
        slug: `yoshi-${repo.language}-admins`,
        permission: 'admin',
      },
      {
        slug: `yoshi-${repo.language}`,
        permission: 'push',
      },
    ];

    for (const membership of teamsToAdd) {
      await octo.teams
        .addOrUpdateRepoInOrg({
          team_slug: membership.slug,
          owner,
          org: owner,
          permission: membership.permission as 'push',
          repo: name,
        })
        .catch(e => {
          console.error(`Error adding ${membership.slug} to ${repo.repo}.`);
          console.error(e);
        });
    }
  }
}

/**
 * Update the main repository options
 * @param repos List of repos to iterate.
 */
async function updateRepoOptions(repos: Repo[]) {
  console.log(`Updating commit settings...`);
  for (const repo of repos) {
    const [owner, name] = repo.repo.split('/');
    await octo.repos
      .update({
        name,
        repo: name,
        owner,
        allow_merge_commit: false,
        allow_rebase_merge: true,
        allow_squash_merge: true,
      })
      .catch(e => {
        console.error(`Error changing repo settings on ${repo.repo}`);
        console.error(e);
      });
  }
}

const languageConfig: LanguageConfig = {
  python: {
    requiredStatusChecks: ['Kokoro', 'cla/google'],
    ignoredRepos: [
      'GoogleCloudPlatform/python-docs-samples',
      'GoogleCloudPlatform/getting-started-python',
      'googleapis/releasetool',
      'googleapis/sample-tester',
      'googleapis/synthtool',
      'googleapis/google-cloud-python',
    ],
  },
  nodejs: {
    requiredStatusChecks: [
      'ci/kokoro: Samples test',
      'ci/kokoro: System test',
      'ci/kokoro: Windows',
      'ci/kokoro: docs',
      'ci/kokoro: lint',
      'ci/kokoro: node8',
      'ci/kokoro: node10',
      'ci/kokoro: node12',
      'cla/google',
    ],
    ignoredRepos: [
      'GoogleCloudPlatform/nodejs-docs-samples',
      'GoogleCloudPlatform/getting-started-nodejs',
      'googleapis/gapic-generator-typescript',
    ],
  },
};

interface LanguageConfig {
  [index: string]: {
    requiredStatusChecks: string[];
    ignoredRepos?: string[];
  };
}
