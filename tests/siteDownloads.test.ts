import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, channelManifest, frontButtons, REPO, ROWS, safeUrl } from "../scripts/site-downloads.mjs";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");
/** A signature in tauri's format naming `version`: well formed, not checked against a key here. */
const sig = (version: string) =>
  b64(`untrusted comment: signature from tauri secret key\n${b64(Buffer.concat([Buffer.from("ED"), Buffer.alloc(72, 1)]))}\ntrusted comment: timestamp:1793750182\tfile:x\tversion:${version}\n${b64(Buffer.alloc(64, 2))}\n`);

/** Where build <n>'s files are: its own release, build-<n>. */
const folder = (n: number) => `${REPO}/releases/download/build-${n}`;
/** A channel's latest.json for build 0.2.<n>, as the Release workflow writes it. */
function manifest(n: number) {
  const v = `0.2.${n}`;
  return {
    version: v, notes: "Example notes", pub_date: "2026-11-09T18:51:46Z",
    platforms: {
      "linux-x86_64": { signature: sig(v), url: `${folder(n)}/myorbiter_${v}_amd64.AppImage` },
      "windows-x86_64": { signature: sig(v), url: `${folder(n)}/myorbiter_${v}_x64-setup.exe` },
    },
    commit: "0".repeat(40),
  };
}
/** The releases API's answer for build-<n>, trimmed to what the site reads. */
function release(n: number, files = ["AppImage", "deb", "exe", "sums"], prerelease = true) {
  const v = `0.2.${n}`;
  const names: Record<string, string> = { AppImage: `myorbiter_${v}_amd64.AppImage`, deb: `myorbiter_${v}_amd64.deb`, exe: `myorbiter_${v}_x64-setup.exe`, sums: "SHA256SUMS" };
  const assets = files.map((f) => ({ name: names[f], browser_download_url: `${folder(n)}/${names[f]}` }));
  assets.push({ name: `myorbiter_${v}_amd64.AppImage.sig`, browser_download_url: `${folder(n)}/myorbiter_${v}_amd64.AppImage.sig` });
  return { tag_name: `build-${n}`, published_at: `2026-11-0${1 + (n % 8)}T12:00:00Z`, prerelease, draft: false, assets };
}

test("a channel's manifest is the latest.json on the release named after it", () => {
  assert.equal(channelManifest("stable"), "https://github.com/ShezissSnake/myorbiter/releases/download/stable/latest.json");
  assert.equal(channelManifest("experimental"), "https://github.com/ShezissSnake/myorbiter/releases/download/experimental/latest.json");
});

test("the front page offers the best channel with a build, and says which", () => {
  const exp = frontButtons({ stable: null, beta: null, experimental: manifest(126) });
  assert.equal(exp.label, "Download 0.2.126 · Experimental build");
  assert.equal(exp.tag, "build-126");
  assert.deepEqual(exp.buttons, {
    windows: `${folder(126)}/myorbiter_0.2.126_x64-setup.exe`,
    linux: `${folder(126)}/myorbiter_0.2.126_amd64.AppImage`,
    deck: `${folder(126)}/myorbiter_0.2.126_amd64.AppImage`,
  });
  assert.equal(frontButtons({ stable: null, beta: manifest(124), experimental: manifest(126) }).label, "Download 0.2.124 · Beta build");
  assert.equal(frontButtons({ stable: manifest(121), beta: manifest(124), experimental: manifest(126) }).label, "Download 0.2.121 · Stable build");
});

test("the front page refuses a missing or malformed manifest rather than link a wrong file", () => {
  assert.throws(() => frontButtons({ stable: null, beta: null, experimental: null }), /No channel has a build/);
  const noWindows = manifest(126);
  delete (noWindows.platforms as Partial<typeof noWindows.platforms>)["windows-x86_64"];
  assert.throws(() => frontButtons({ experimental: noWindows }), /experimental\/latest\.json.*no windows-x86_64 build/);
  const elsewhere = manifest(126);
  elsewhere.platforms["linux-x86_64"].url = "https://example.com/myorbiter_0.2.126_amd64.AppImage";
  assert.throws(() => frontButtons({ experimental: elsewhere }), /isn't on/);
  const otherBuild = manifest(126);
  otherBuild.platforms["linux-x86_64"].url = `${folder(124)}/myorbiter_0.2.124_amd64.AppImage`;
  assert.throws(() => frontButtons({ experimental: otherBuild }), /isn't on/);
  const gitlab = manifest(126);
  gitlab.platforms["linux-x86_64"].url = "https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/myorbiter/0.2.126/myorbiter_0.2.126_amd64.AppImage";
  assert.throws(() => frontButtons({ experimental: gitlab }), /isn't on/);
  const wrongSig = manifest(126);
  wrongSig.platforms["windows-x86_64"].signature = sig("0.2.125");
  assert.throws(() => frontButtons({ experimental: wrongSig }), /signed for 0\.2\.125/);
  assert.throws(() => frontButtons({ experimental: { ...manifest(126), version: "1.0" } }), /names no build version/);
  assert.throws(() => frontButtons({ experimental: [] }), /not a manifest/);
  // A broken Stable isn't skipped for a good Experimental: it stops the build.
  assert.throws(() => frontButtons({ stable: { version: 7 }, experimental: manifest(126) }), /stable\/latest\.json/);
  // Nor is a broken Beta or Experimental behind a good Stable: the rows are labelled from them.
  assert.throws(() => frontButtons({ stable: manifest(121), beta: otherBuild }), /beta\/latest\.json/);
  assert.throws(() => frontButtons({ stable: manifest(121), experimental: wrongSig }), /experimental\/latest\.json/);
});

test("downloads.html lists the newest ten builds made on GitHub, each with the files it carries", () => {
  const releases: unknown[] = [121, 132, 123, 124, 125, 126, 127, 128, 129, 130, 131, 122].map((n) => release(n, undefined, n !== 124));
  // The channels' own releases, builds from before the move to GitLab, a draft: none is a row.
  releases.push({ tag_name: "experimental", published_at: "2026-11-08T00:00:00Z", prerelease: true, draft: false, assets: [] });
  releases.push(release(30));
  releases.push({ ...release(133), draft: true });
  const rows = buildRows(releases, { heads: { experimental: manifest(132), beta: manifest(130) } });
  assert.equal(rows.length, ROWS);
  assert.deepEqual(rows.map((r) => r.version), [132, 131, 130, 129, 128, 127, 126, 125, 124, 123].map((n) => `0.2.${n}`));
  assert.deepEqual(rows[0].files, {
    appimage: { name: "myorbiter_0.2.132_amd64.AppImage", url: `${folder(132)}/myorbiter_0.2.132_amd64.AppImage` },
    deb: { name: "myorbiter_0.2.132_amd64.deb", url: `${folder(132)}/myorbiter_0.2.132_amd64.deb` },
    exe: { name: "myorbiter_0.2.132_x64-setup.exe", url: `${folder(132)}/myorbiter_0.2.132_x64-setup.exe` },
  });
  assert.equal(rows[0].notes, `${REPO}/releases/tag/build-132`);
  assert.equal(rows[0].sums, `${folder(132)}/SHA256SUMS`);
  assert.equal(rows[0].date, "2026-11-05");
  // What's known: the channels' current builds, and every build ever Stable (a full release).
  assert.deepEqual(rows.map((r) => r.channel), ["Experimental", null, "Beta", null, null, null, null, null, "Stable", null]);
});

test("a row lacks a button for a file its build lacks; a file elsewhere stops the build", () => {
  const [row] = buildRows([release(127, ["AppImage", "deb"])]);
  assert.deepEqual(Object.keys(row.files), ["appimage", "deb"]);
  assert.equal(row.sums, null);
  const bad = release(127);
  bad.assets[2].browser_download_url = "https://example.com/myorbiter_0.2.127_x64-setup.exe";
  assert.throws(() => buildRows([bad]), /links to https:\/\/example\.com/);
  const mislabelled = release(127);
  mislabelled.assets[0] = { name: "myorbiter_0.2.99_amd64.AppImage", browser_download_url: `${folder(127)}/myorbiter_0.2.99_amd64.AppImage` };
  assert.throws(() => buildRows([mislabelled]), /isn't 0\.2\.127's/);
  const otherRelease = release(127);
  otherRelease.assets[0].browser_download_url = `${folder(126)}/myorbiter_0.2.127_amd64.AppImage`;
  assert.throws(() => buildRows([otherRelease]), /not to .*build-127\/myorbiter_0\.2\.127_amd64\.AppImage/);
  const sumsElsewhere = release(127);
  sumsElsewhere.assets[3].browser_download_url = `${REPO}/raw/main/SHA256SUMS`;
  assert.throws(() => buildRows([sumsElsewhere]), /SHA256SUMS links to/);
  assert.throws(() => buildRows([{ ...release(127), published_at: "soon" }]), /no release date/);
  assert.throws(() => buildRows({} as never), /not a list/);
});

test("only this repository's pages on github.com pass", () => {
  assert.equal(safeUrl(`${folder(121)}/a.deb`), `${folder(121)}/a.deb`);
  assert.equal(safeUrl(`${REPO}/blob/main/docs/privacy.md`), `${REPO}/blob/main/docs/privacy.md`);
  for (const u of [
    "http://github.com/ShezissSnake/myorbiter/x",
    "https://github.com.example.com/ShezissSnake/myorbiter/x",
    "https://user@github.com/ShezissSnake/myorbiter/x",
    "https://github.com/ShezissSnake/orbiter/x",
    "https://github.com/ShezissSnake/myorbiter-other/x",
    "https://github.com/someone/myorbiter/x",
    "https://gitlab.com/sheziss-group/myorbiter/-/releases",
    `${folder(121)}/a.deb?x=1`,
    "javascript:alert(1)",
  ])
    assert.equal(safeUrl(u), null, u);
});
