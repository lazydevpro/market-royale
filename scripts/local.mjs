// Local app + operator supervisor. Dedicated wallet secrets remain in ignored files.
import { spawn } from "node:child_process";
import fs from "node:fs";
const root = new URL("../", import.meta.url);
for (const p of [".env.local", "workers/.dev.vars"])
  if (!fs.existsSync(new URL(p, root))) throw Error(`Missing ${p}. See README.md.`);
let stopping = false;
const children = new Set(), timers = new Set();
function stopGroup(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error?.code !== "ESRCH") throw error; }
}
function supervise(name, script, args, attempts = 0) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root, stdio: "inherit", env: process.env, detached: true,
  });
  children.add(child);
  const started = Date.now();
  child.on("exit", (code) => {
    children.delete(child);
    stopGroup(child);
    if (stopping) return;
    const failures = Date.now() - started > 60000 ? 0 : attempts + 1;
    const delay = Math.min(30000, 2000 * 2 ** Math.min(failures,4));
    console.error(`${name} exited (${code}). Restarting in ${delay/1000}s; its companion stays available.`);
    const timer = setTimeout(() => {timers.delete(timer);supervise(name,script,args,failures);}, delay);
    timers.add(timer);
  });
}
const watchdog = setInterval(() => {
  fetch("http://127.0.0.1:8787/wake", {method:"POST",signal:AbortSignal.timeout(5000)}).catch(() => {});
}, 15000);
function stop() {
  if(stopping)return; stopping=true;clearInterval(watchdog);
  for(const t of timers)clearTimeout(t);
  for(const p of children)stopGroup(p);
  const force = setTimeout(() => {
    for(const p of children)stopGroup(p,"SIGKILL");
  },750);
  force.unref();
  setTimeout(()=>process.exit(0),1000).unref();
}
supervise("Web app","node_modules/next/dist/bin/next",["dev","--hostname","127.0.0.1","--port","3000"]);
supervise("Event operator","node_modules/wrangler/bin/wrangler.js",["dev","--config","workers/wrangler.jsonc","--ip","127.0.0.1","--port","8787"]);
process.on("SIGINT",stop);process.on("SIGTERM",stop);
console.log("Market Royale: http://127.0.0.1:3000 · operator: http://127.0.0.1:8787/status");
