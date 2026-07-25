const test = require("node:test");
const assert = require("node:assert/strict");
const { isPublicStaticFile } = require("./static-files");

test("공개 프론트 파일만 정적 서빙을 허용한다", () => {
  assert.equal(isPublicStaticFile("index.html"), true);
  assert.equal(isPublicStaticFile("app.html"), true);
  assert.equal(isPublicStaticFile("doctor.html"), true);
  assert.equal(isPublicStaticFile("favicon.png"), true);
});

test("저장소 내부 파일과 시크릿 후보는 허용 목록에 없다", () => {
  assert.equal(isPublicStaticFile("server.js"), false);
  assert.equal(isPublicStaticFile("package.json"), false);
  assert.equal(isPublicStaticFile("CLAUDE.md"), false);
  assert.equal(isPublicStaticFile("SUPABASE_보안강화_20260619.sql"), false);
  assert.equal(isPublicStaticFile(".git"), false);
  assert.equal(isPublicStaticFile("HEAD"), false);
});

test("문자열이 아니거나 비어 있으면 항상 거부한다", () => {
  assert.equal(isPublicStaticFile(undefined), false);
  assert.equal(isPublicStaticFile(null), false);
  assert.equal(isPublicStaticFile(""), false);
  assert.equal(isPublicStaticFile(42), false);
});
