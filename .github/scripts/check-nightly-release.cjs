// Release helpers for .github/workflows/release.yml (run via actions/github-script).

// The schedule fires daily; the gap only keeps a manual nightly from being
// followed by a near-duplicate scheduled one.
const MINIMUM_RELEASE_GAP_MS = 20 * 60 * 60 * 1000;

const isNightlyTag = (tag) => /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(tag);

function defaultBranch(context) {
  const branch = context.payload.repository?.default_branch;
  if (!branch) throw new Error("GitHub did not provide the repository default branch.");
  return branch;
}

async function assertCommitOnDefaultBranch({ github, context, sha }) {
  const branch = defaultBranch(context);
  const { data } = await github.rest.repos.compareCommitsWithBasehead({
    ...context.repo,
    basehead: `${sha}...${branch}`,
    per_page: 1,
  });
  if (data.status !== "ahead" && data.status !== "identical") {
    throw new Error(`Release commit ${sha} is not on ${branch} (${data.status}).`);
  }
}

// Newest published nightly, or undefined when there is none.
async function findLatestNightly({ github, context }) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...context.repo,
    per_page: 100,
  });
  return releases
    .filter((release) => !release.draft && release.published_at && isNightlyTag(release.tag_name))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}

// A nightly is due when the last one is at least 20 hours old and main has
// moved since its tag.
async function shouldReleaseNightly({ github, context, core, now = Date.now() }) {
  const last = await findLatestNightly({ github, context });
  if (!last) {
    core.info("No published nightly yet. Releasing.");
    return true;
  }
  if (now - Date.parse(last.published_at) < MINIMUM_RELEASE_GAP_MS) {
    core.info(`${last.tag_name} was published less than 20 hours ago. Skipping.`);
    return false;
  }
  const { data } = await github.rest.repos.compareCommitsWithBasehead({
    ...context.repo,
    basehead: `${last.tag_name}...${context.sha}`,
    per_page: 1,
  });
  if (data.status !== "ahead") {
    core.info(`No new commits since ${last.tag_name} (${data.status}). Skipping.`);
    return false;
  }
  core.info(`New commits since ${last.tag_name}. Releasing.`);
  return true;
}

// Stable releases ship exactly the commit the latest nightly shipped, under
// the version that nightly previewed (0.2.1-nightly.* -> 0.2.1).
async function resolveLatestNightlyCommit({ github, context, core }) {
  const last = await findLatestNightly({ github, context });
  if (!last) throw new Error("No published nightly found to promote to stable.");
  const { data: commit } = await github.rest.repos.getCommit({
    ...context.repo,
    ref: last.tag_name,
  });
  const version = /^v(\d+\.\d+\.\d+)-nightly\./.exec(last.tag_name)?.[1];
  if (!version) throw new Error(`Cannot derive a stable version from ${last.tag_name}.`);
  core.info(`Latest nightly ${last.tag_name} shipped ${commit.sha} as a preview of ${version}.`);
  return { tag: last.tag_name, sha: commit.sha, version };
}

module.exports = {
  isNightlyTag,
  assertCommitOnDefaultBranch,
  findLatestNightly,
  shouldReleaseNightly,
  resolveLatestNightlyCommit,
};
