import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, frontButtons, PACKAGES, REPO, ROWS, safeUrl, stableVersions } from "../scripts/site-downloads.mjs";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");
/** A signature in tauri's format naming `version`: well formed, not checked against a key here. */
const sig = (version: string) =>
  b64(`untrusted comment: signature from tauri secret key\n${b64(Buffer.concat([Buffer.from("ED"), Buffer.alloc(72, 1)]))}\ntrusted comment: timestamp:1793750182\tfile:x\tversion:${version}\n${b64(Buffer.alloc(64, 2))}\n`);

const folder = (v: string) => `${PACKAGES}/myorbiter/${v}`;
/** A channel's latest.json for build 0.2.<n>, as ci/publish.sh writes it. */
function manifest(n: number) {
  const v = `0.2.${n}`;
  return {
    version: v, notes: "Example notes", pub_date: "2026-11-08T18:51:46Z",
    platforms: {
      "linux-x86_64": { signature: sig(v), url: `${folder(v)}/myorbiter_${v}_amd64.AppImage` },
      "windows-x86_64": { signature: sig(v), url: `${folder(v)}/myorbiter_${v}_x64-setup.exe` },
    },
    commit: "0".repeat(40),
  };
}
/** The releases API's answer for build-<n>, trimmed to what the site reads. */
function release(n: number, files = ["AppImage", "deb", "exe", "sums"]) {
  const v = `0.2.${n}`;
  const names: Record<string, string> = { AppImage: `myorbiter_${v}_amd64.AppImage`, deb: `myorbiter_${v}_amd64.deb`, exe: `myorbiter_${v}_x64-setup.exe`, sums: "SHA256SUMS" };
  const links = files.map((f) => ({ name: names[f], url: `${folder(v)}/${names[f]}` }));
  links.push({ name: `myorbiter_${v}_amd64.AppImage.sig`, url: `${folder(v)}/myorbiter_${v}_amd64.AppImage.sig` });
  return { tag_name: `build-${n}`, released_at: `2026-11-0${1 + (n % 8)}T12:00:00.000Z`, assets: { links } };
}

test("the front page offers the best channel with a build, and says which", () => {
  const exp = frontButtons({ stable: null, beta: null, experimental: manifest(106) });
  assert.equal(exp.label, "Download 0.2.106 · Experimental build");
  assert.equal(exp.tag, "build-106");
  assert.deepEqual(exp.buttons, {
    windows: `${folder("0.2.106")}/myorbiter_0.2.106_x64-setup.exe`,
    linux: `${folder("0.2.106")}/myorbiter_0.2.106_amd64.AppImage`,
    deck: `${folder("0.2.106")}/myorbiter_0.2.106_amd64.AppImage`,
  });
  assert.equal(frontButtons({ stable: null, beta: manifest(104), experimental: manifest(106) }).label, "Download 0.2.104 · Beta build");
  assert.equal(frontButtons({ stable: manifest(101), beta: manifest(104), experimental: manifest(106) }).label, "Download 0.2.101 · Stable build");
});

test("the front page refuses a missing or malformed manifest rather than link a wrong file", () => {
  assert.throws(() => frontButtons({ stable: null, beta: null, experimental: null }), /No channel has a build/);
  const noWindows = manifest(106);
  delete (noWindows.platforms as Partial<typeof noWindows.platforms>)["windows-x86_64"];
  assert.throws(() => frontButtons({ experimental: noWindows }), /channel\/experimental.*no windows-x86_64 build/);
  const elsewhere = manifest(106);
  elsewhere.platforms["linux-x86_64"].url = "https://example.com/myorbiter_0.2.106_amd64.AppImage";
  assert.throws(() => frontButtons({ experimental: elsewhere }), /isn't in/);
  const otherBuild = manifest(106);
  otherBuild.platforms["linux-x86_64"].url = `${folder("0.2.104")}/myorbiter_0.2.104_amd64.AppImage`;
  assert.throws(() => frontButtons({ experimental: otherBuild }), /isn't in/);
  const wrongSig = manifest(106);
  wrongSig.platforms["windows-x86_64"].signature = sig("0.2.105");
  assert.throws(() => frontButtons({ experimental: wrongSig }), /signed for 0\.2\.105/);
  assert.throws(() => frontButtons({ experimental: { ...manifest(106), version: "1.0" } }), /names no build version/);
  assert.throws(() => frontButtons({ experimental: [] }), /not a manifest/);
  // A broken Stable isn't skipped for a good Experimental: it stops the build.
  assert.throws(() => frontButtons({ stable: { version: 7 }, experimental: manifest(106) }), /channel\/stable/);
  // Nor is a broken Beta or Experimental behind a good Stable: the rows are labelled from them.
  assert.throws(() => frontButtons({ stable: manifest(101), beta: otherBuild }), /channel\/beta/);
  assert.throws(() => frontButtons({ stable: manifest(101), experimental: wrongSig }), /channel\/experimental/);
});

test("downloads.html lists the newest ten builds, each with the files it carries", () => {
  const releases = [101, 112, 103, 104, 105, 106, 107, 108, 109, 110, 111, 102].map((n) => release(n));
  releases.push({ tag_name: "v9.9.9", released_at: "2026-11-08T00:00:00Z", assets: { links: [] } });
  const rows = buildRows(releases, { heads: { experimental: manifest(112), beta: manifest(110) }, stableBuilds: ["0.2.104"] });
  assert.equal(rows.length, ROWS);
  assert.deepEqual(rows.map((r) => r.version), [112, 111, 110, 109, 108, 107, 106, 105, 104, 103].map((n) => `0.2.${n}`));
  assert.deepEqual(rows[0].files, {
    appimage: { name: "myorbiter_0.2.112_amd64.AppImage", url: `${folder("0.2.112")}/myorbiter_0.2.112_amd64.AppImage` },
    deb: { name: "myorbiter_0.2.112_amd64.deb", url: `${folder("0.2.112")}/myorbiter_0.2.112_amd64.deb` },
    exe: { name: "myorbiter_0.2.112_x64-setup.exe", url: `${folder("0.2.112")}/myorbiter_0.2.112_x64-setup.exe` },
  });
  assert.equal(rows[0].notes, `${REPO}/-/releases/build-112`);
  assert.equal(rows[0].sums, `${folder("0.2.112")}/SHA256SUMS`);
  assert.equal(rows[0].date, "2026-11-01");
  // Only what the registry records: the channels' current builds and every build ever Stable.
  assert.deepEqual(rows.map((r) => r.channel), ["Experimental", null, "Beta", null, null, null, null, null, "Stable", null]);
});

test("a row lacks a button for a file its build lacks; a file elsewhere stops the build", () => {
  const [row] = buildRows([release(107, ["AppImage", "deb"])]);
  assert.deepEqual(Object.keys(row.files), ["appimage", "deb"]);
  assert.equal(row.sums, null);
  const bad = release(107);
  bad.assets.links[2].url = "https://example.com/myorbiter_0.2.107_x64-setup.exe";
  assert.throws(() => buildRows([bad]), /links to https:\/\/example\.com/);
  const mislabelled = release(107);
  mislabelled.assets.links[0] = { name: "myorbiter_0.2.99_amd64.AppImage", url: `${folder("0.2.99")}/myorbiter_0.2.99_amd64.AppImage` };
  assert.throws(() => buildRows([mislabelled]), /isn't 0\.2\.107's/);
  const otherFolder = release(107);
  otherFolder.assets.links[0].url = `${folder("0.2.99")}/myorbiter_0.2.107_amd64.AppImage`;
  assert.throws(() => buildRows([otherFolder]), /not to .*0\.2\.107\/myorbiter_0\.2\.107_amd64\.AppImage/);
  const sumsElsewhere = release(107);
  sumsElsewhere.assets.links[3].url = `${REPO}/-/raw/main/SHA256SUMS`;
  assert.throws(() => buildRows([sumsElsewhere]), /SHA256SUMS links to/);
  assert.throws(() => buildRows([{ ...release(107), released_at: "soon" }]), /no release date/);
  assert.throws(() => buildRows({} as never), /not a list/);
});

test("only this project's files on gitlab.com pass, and stable-builds lists versions", () => {
  assert.equal(safeUrl(`${folder("0.2.1")}/a.deb`), `${folder("0.2.1")}/a.deb`);
  for (const u of ["http://gitlab.com/sheziss-group/myorbiter/x", "https://gitlab.com.example.com/sheziss-group/myorbiter/x", "https://user@gitlab.com/sheziss-group/myorbiter/x", "https://gitlab.com/other/project/x", `${folder("0.2.1")}/a.deb?x=1`, "javascript:alert(1)"])
    assert.equal(safeUrl(u), null, u);
  assert.deepEqual(stableVersions([{ name: "stable-builds", version: "0.2.104" }, { name: "stable-builds", version: "x" }, { name: "myorbiter", version: "0.2.9" }]), ["0.2.104"]);
});
