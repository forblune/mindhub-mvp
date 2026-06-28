const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const htmlFiles = ["index.html", "app.html", "doctor.html"];
const jsFiles = [
  "playwright.config.js",
  "backend/server.js",
  "backend/conversation-style.js",
  "backend/adoption-consultation.js",
  "backend/conversation-style.test.js",
  "backend/adoption-consultation.test.js",
  "tests/e2e/index.spec.js",
  "tests/e2e/doctor-demo.spec.js"
];

function parseJavaScript(label, code){
  try{
    new Function(code);
  }catch(error){
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

for(const file of htmlFiles){
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  scripts.forEach((code, index) => parseJavaScript(`${file} inline script #${index + 1}`, code));
}

for(const file of jsFiles){
  parseJavaScript(file, fs.readFileSync(path.join(root, file), "utf8"));
}

console.log(`Static validation passed: ${htmlFiles.length} HTML files, ${jsFiles.length} JS files`);
