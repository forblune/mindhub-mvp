const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const htmlFiles = ["index.html", "app.html", "doctor.html"];
const jsFiles = [
  "scripts/check-static.js",
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

function rejectFocusedTests(label, code){
  const focusedTestPattern = /\b(?:test\s*\.\s*describe|test|it|describe)\s*\.\s*only\s*\(/;
  if(focusedTestPattern.test(code)){
    throw new Error(`${label}: remove focused test before committing`);
  }
}

function validateHtmlReferences(label, html){
  const ids = new Set([...html.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/gi)].map(match => match[2]));
  const referenceAttrs = ["aria-labelledby", "aria-describedby", "aria-controls"];
  for(const attr of referenceAttrs){
    const pattern = new RegExp(`\\b${attr}\\s*=\\s*(["'])([^"']*)\\1`, "gi");
    for(const match of html.matchAll(pattern)){
      const refs = match[2].trim().split(/\s+/).filter(Boolean);
      if(!refs.length){
        throw new Error(`${label}: ${attr} must reference at least one id`);
      }
      for(const ref of refs){
        if(!ids.has(ref)){
          throw new Error(`${label}: ${attr} references missing id "${ref}"`);
        }
      }
    }
  }

  for(const match of html.matchAll(/\bhref\s*=\s*(["'])#([^"']*)\1/gi)){
    const target = match[2].trim();
    if(target && !ids.has(target)){
      throw new Error(`${label}: href="#${target}" references missing id "${target}"`);
    }
  }
}

for(const file of htmlFiles){
  const html = fs.readFileSync(path.join(root, file), "utf8");
  validateHtmlReferences(file, html);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  scripts.forEach((code, index) => parseJavaScript(`${file} inline script #${index + 1}`, code));
}

for(const file of jsFiles){
  const code = fs.readFileSync(path.join(root, file), "utf8");
  parseJavaScript(file, code);
  if(/\.(test|spec)\.js$/.test(file)) rejectFocusedTests(file, code);
}

console.log(`Static validation passed: ${htmlFiles.length} HTML files, ${jsFiles.length} JS files`);
