import { resolveForm } from "./resolver.js";

const select = document.getElementById("dataset");
const stage = document.getElementById("stage");
const legend = document.getElementById("legend");
const jsonOut = document.getElementById("resolved-json");

let template = null;

async function loadTemplate() {
  const res = await fetch("data/w2/annotation.json");
  template = await res.json();
}

async function render() {
  const res = await fetch(`data/w2/${select.value}`);
  const values = await res.json();
  const resolved = resolveForm(template, values);

  // clear previous boxes (keep the <img>)
  stage.querySelectorAll(".demo-box").forEach((el) => el.remove());

  let drawn = 0;
  let skipped = 0;
  for (const field of resolved) {
    if (field.skipped) {
      skipped++;
      continue;
    }
    if (!field.value) continue;
    drawn++;
    const box = document.createElement("div");
    box.className = "demo-box";
    box.style.left = field.position.x + "px";
    box.style.top = field.position.y + "px";
    box.style.width = field.position.width + "px";
    box.style.height = field.position.height + "px";
    box.title = field.id;

    const label = document.createElement("span");
    label.className = "demo-value";
    label.textContent = field.value;
    box.appendChild(label);

    stage.appendChild(box);
  }

  legend.textContent = `${drawn} boxes drawn, ${skipped} skipped by conditional rules — resolved live in your browser from data/w2/${select.value}.`;
  jsonOut.textContent = JSON.stringify(resolved, null, 2);
}

select.addEventListener("change", render);
loadTemplate().then(render);
