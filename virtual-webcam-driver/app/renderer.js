async function start() {
  await window.api.start();
  document.getElementById('status').innerText = "Status: Running";
}

async function stop() {
  await window.api.stop();
  document.getElementById('status').innerText = "Status: Stopped";
}