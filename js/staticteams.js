import { siteURL } from "./paths.js";

const cards = [...document.querySelectorAll(".pg-team-card")];
let runtime;

function loadRuntime() {
  if (!runtime) runtime = (async () => {
    const [db, i18n, labels, { buildPanel }] = await Promise.all([
      import("./db.js"), import("./i18n.js"), import("./labels.js"),
      import("./teamdetail.js"),
    ]);
    const response = await fetch(siteURL("names.json"), { cache: "no-cache" });
    if (!response.ok) throw new Error(`names.json: ${response.status}`);
    const names = await response.json();
    await Promise.all([
      db.init(names),
      i18n.init({ language: document.documentElement.lang, updateDocument: false }),
    ]);
    await labels.init(names);
    return { db, buildPanel };
  })().catch((error) => { runtime = null; throw error; });
  return runtime;
}

for (const card of cards) {
  card.addEventListener("toggle", async () => {
    if (!card.open) return;
    for (const other of cards) if (other !== card) other.open = false;
    if (card.dataset.loaded || card._loading) return;
    card._loading = true;
    const host = card.querySelector(".pg-team-expanded");
    host.querySelector(".pg-detail-error")?.remove();
    host.setAttribute("aria-busy", "true");
    try {
      const { db, buildPanel } = await loadRuntime();
      let teamIndex = Number(card.dataset.teamIndex);
      let variants = db.teamBuilds(teamIndex);
      if (variants[0]?.chars.join(",") !== card.dataset.chars) {
        const team = db.query({ consMode: "any", fiveStar: "any" })
          .find((t) => t.chars.join(",") === card.dataset.chars);
        teamIndex = team?.teamIndex;
        variants = db.teamBuilds(teamIndex);
      }
      const team = db.meta().generated === card.dataset.dbVersion
        ? variants[Number(card.dataset.buildIndex)]
        : variants.find((v) => v.src === card.dataset.src);
      if (!team) throw new Error("Build no longer exists in the database");
      const panel = await buildPanel(team);
      host.replaceChildren(panel);
      card.dataset.loaded = "true";
    } catch (error) {
      console.error("Team details failed", error);
      const message = document.createElement("p");
      message.className = "pg-detail-error";
      message.textContent = document.body.dataset.teamLoadError;
      host.appendChild(message);
    } finally {
      card._loading = false;
      host.removeAttribute("aria-busy");
    }
  });
}
