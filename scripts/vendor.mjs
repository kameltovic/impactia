// Copie dans vendor/ les bibliothèques front utilisées par le site, pour qu'il fonctionne sans CDN.
//   npm install && npm run vendor
// Mettre à jour une bibliothèque : changer sa version dans package.json, puis relancer ces deux commandes.
import { cpSync, mkdirSync, rmSync } from "node:fs";

const nm = "node_modules/";
rmSync("vendor", { recursive: true, force: true });
mkdirSync("vendor/logos", { recursive: true });
const copy = (from, to) => cpSync(nm + from, "vendor/" + to, { recursive: true });

copy("lucide/dist/umd/lucide.min.js", "lucide.min.js");
copy("tom-select/dist/js/tom-select.complete.min.js", "tom-select.complete.min.js");
copy("tom-select/dist/css/tom-select.min.css", "tom-select.min.css");
copy("flag-icons/css/flag-icons.min.css", "flag-icons/css/flag-icons.min.css");
copy("flag-icons/flags/4x3", "flag-icons/flags/4x3");

// Logos de fournisseurs (Lobe Icons). Un fournisseur absent de cette liste s'affiche avec son initiale.
const logos = ["openai", "claude-color", "anthropic", "mistral-color", "gemini-color", "meta-color", "deepseek-color", "qwen-color",
  "cohere-color", "xai", "perplexity-color", "nvidia-color", "microsoft-color", "aws-color", "huggingface-color"];
for (const l of logos) copy(`@lobehub/icons-static-svg/icons/${l}.svg`, `logos/${l}.svg`);
console.log(`vendor/ prêt (${logos.length} logos)`);
