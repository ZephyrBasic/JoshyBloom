/* The only thing this controller is allowed to do: read two files from the
   repo and write them back in one commit. It never touches the live site —
   Cloudflare Pages picks the commit up and redeploys. If this Worker is down,
   broken or deleted, the published site is unaffected. */

const API = "https://api.github.com";

export class GitHubError extends Error {}

export function repoClient(env) {
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = "main" } = env;
  const base = `${API}/repos/${GITHUB_REPO}`;

  async function call(path, init = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "joshybloom-calendar-controller",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new GitHubError(`GitHub ${init.method || "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  }

  const decode = (b64) => new TextDecoder().decode(
    Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0))
  );

  return {
    /** Current content of the two files we manage, plus the commit they came
        from — so the write can be rejected if anything moved underneath us. */
    async read() {
      const ref = await call(`/git/ref/heads/${GITHUB_BRANCH}`);
      const headSha = ref.object.sha;
      const [events, calendar] = await Promise.all([
        call(`/contents/data/events.json?ref=${headSha}`),
        call(`/contents/public/calendar.html?ref=${headSha}`),
      ]);
      return {
        headSha,
        events: JSON.parse(decode(events.content)),
        calendar: decode(calendar.content),
      };
    },

    /**
     * One atomic commit containing both files, via the Git Data API. Fails
     * loudly on a non-fast-forward rather than forcing, so a concurrent edit
     * is never silently discarded — the caller retries from a fresh read.
     */
    async commit({ headSha, files, message }) {
      const head = await call(`/git/commits/${headSha}`);

      const blobs = await Promise.all(
        Object.entries(files).map(async ([path, content]) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: (await call(`/git/blobs`, {
            method: "POST",
            body: JSON.stringify({ content, encoding: "utf-8" }),
          })).sha,
        }))
      );

      const tree = await call(`/git/trees`, {
        method: "POST",
        body: JSON.stringify({ base_tree: head.tree.sha, tree: blobs }),
      });

      const commit = await call(`/git/commits`, {
        method: "POST",
        body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
      });

      await call(`/git/refs/heads/${GITHUB_BRANCH}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });

      return commit.sha;
    },
  };
}
