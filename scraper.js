#!/usr/bin/env node

import path from "path";
import fs from "fs-extra";
import { glob } from "glob";
import * as cheerio from "cheerio";
import scrape from "website-scraper";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import crypto from "crypto";
import { execSync } from "child_process";

const argv = yargs(hideBin(process.argv))
  .option("url", {
    type: "string",
    demandOption: true,
    describe: "Source website URL",
  })
  .option("keyword", {
    type: "string",
    demandOption: true,
    describe: "Keyword to inject",
  })
  .option("maxDepth", { type: "number", default: 2, describe: "Crawl depth" })
  .strict()
  .help()
  .parse();

const NGINX_PORT = 8088;
const NGINX_ROOT = "/var/www/site";

const TMP_BASE = path.join("/tmp", `scrape-${crypto.randomBytes(4).toString("hex")}`);
const WORK = path.join(TMP_BASE, "site");

async function ensureNginxConf(rootDir) {
  const conf = `server {
    listen ${NGINX_PORT};
    server_name _;
    root ${rootDir};
    index index.html index.htm;

    location / {
      try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|woff2?|ttf)$ {
      access_log off;
      add_header Cache-Control "public,max-age=86400";
    }
  }`;
  await fs.outputFile("/etc/nginx/conf.d/site.conf", conf, "utf8");
}

function injectIntoText($, el, keyword) {
  const text = $(el).text();
  if (!text || text.trim().length === 0) return;
  const i = Math.floor(text.length / 2);
  const mutated = text.slice(0, i) + ` ${keyword} ` + text.slice(i);
  $(el).text(mutated);
}

function injectIntoAlt($, el, keyword) {
  const prev = $(el).attr("alt") || "";
  const next = (prev + " " + keyword).trim();
  $(el).attr("alt", next);
}

async function modifyHTMLFiles(dir, keyword) {
  const files = await glob(["**/*.html", "**/*.htm"], {
    cwd: dir,
    dot: true,
    absolute: true,
  });

  for (const file of files) {
    const html = await fs.readFile(file, "utf8");
    const $ = cheerio.load(html, { decodeEntities: false });

    const t = $("head title");
    if (t.length) t.first().text(`${t.first().text()} | ${keyword}`);
    else $("head").append(`<title>${keyword}</title>`);

    const h1 = $("h1").first();
    if (h1.length) h1.text(`${h1.text()} ${keyword}`);
    else $("body").prepend(`<h1>${keyword}</h1>`);

    const candidates = $("p, span, li").toArray();
    const count = Math.min(5, candidates.length);
    for (let k = 0; k < count; k++) {
      const idx = Math.floor(Math.random() * candidates.length);
      injectIntoText($, candidates[idx], keyword);
    }

    $("img")
      .slice(0, 5)
      .each((_, el) => injectIntoAlt($, el, keyword));

    await fs.writeFile(file, $.html(), "utf8");
  }
}

async function main() {
  await fs.ensureDir(TMP_BASE); 

  console.log("Downloading site to", WORK);
  await scrape({
    urls: [argv.url],
    directory: WORK, 
    recursive: true,
    maxDepth: argv.maxDepth,
    request: { headers: { "user-agent": "Mozilla/5.0 (ScraperBot)" } },
    urlFilter: (url) => url.startsWith(argv.url),
  });

  console.log("Injecting keyword into HTML…");
  await modifyHTMLFiles(WORK, argv.keyword);

  console.log("Publishing to nginx root…");
  await fs.ensureDir(NGINX_ROOT);
  const backup = NGINX_ROOT + "-bak";
  if (await fs.pathExists(NGINX_ROOT))
    await fs.move(NGINX_ROOT, backup, { overwrite: true });
  await fs.move(WORK, NGINX_ROOT, { overwrite: true });
  await fs.remove(backup).catch(() => {});

  await ensureNginxConf(NGINX_ROOT);
  try {
    execSync("nginx -t", { stdio: "inherit" });
    execSync("nginx -s reload || true", { stdio: "inherit" });
  } catch {}

  console.log(`Done. Open: http://localhost:${NGINX_PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});