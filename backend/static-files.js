// server.js가 로컬 개발 편의를 위해 서빙하는 공개 프론트 파일의 명시적 허용 목록.
// 저장소 루트 전체(.git, backend 소스, SQL 마이그레이션 등)를 열지 않기 위해
// 정확히 이 파일들만 허용하고 그 외는 전부 next()로 넘겨 404 처리한다.
const PUBLIC_STATIC_FILES = new Set(["index.html", "app.html", "doctor.html", "favicon.png"]);

function isPublicStaticFile(name){
  return typeof name === "string" && PUBLIC_STATIC_FILES.has(name);
}

module.exports = { PUBLIC_STATIC_FILES, isPublicStaticFile };
