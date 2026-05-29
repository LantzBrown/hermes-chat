// Hermes Web UI — remote API bridge
// Overrides fetch() to route API calls to the remote tunnel.
(function() {
  var STORAGE_KEY = "hrms-remote-url"https://raw.githubusercontent.com/LantzBrown/hermes-chat/main/tunnel-url.json";
  var origFetch = window.fetch;

  function getStored() {
    try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
  }
  function setStored(v) {
    try { localStorage.setItem(STORAGE_KEY, v); } catch {}
  }
  async function testUrl(url) {
    try { var r = await origFetch(url + "/health", { signal: AbortSignal.timeout(8000) }); return r.ok; }
    catch { return false; }
  }
  async function discoverTunnel() {
    try {
      var res = await origFetch(TUNNEL_JSON, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      var data = await res.json();
      if (data.url && data.url.startsWith("https://")) {
        if (await testUrl(data.url)) return data.url;
      }
    } catch {}
    return null;
  }

  // State
  window.__HERMES_REMOTE_URL = "";
  window.__HERMES_REMOTE_READY = false;

  // Override fetch to redirect API calls
  window.fetch = function(input, init) {
    var url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
    var remote = window.__HERMES_REMOTE_URL;
    // Redirect /api/* and api/* calls to remote
    if (remote && (url.startsWith("/api/") || url.startsWith("api/") || url.match(/^https?:\/\/[^/]+\/api\//))) {
      var rel = url.replace(/^https?:\/\/[^\/]+/, "").replace(/^\//, "");
      if (rel.startsWith("api/")) {
        var newUrl = remote + "/" + rel;
        return origFetch(newUrl, init);
      }
    }
    return origFetch(input, init);
  };

  // Override EventSource to route to remote
  var OrigES = window.EventSource;
  window.EventSource = function(url, opts) {
    var remote = window.__HERMES_REMOTE_URL;
    if (remote) {
      var rel = (typeof url === 'string' ? url : String(url));
      if (rel.startsWith('/api/') || rel.startsWith('api/')) {
        rel = rel.replace(/^\//, '');
        url = remote + '/' + rel;
      }
    }
    return new OrigES(url, opts);
  };
  window.EventSource.prototype = OrigES.prototype;

  // Init
  (async function() {
    var stored = getStored();
    if (stored && await testUrl(stored)) {
      window.__HERMES_REMOTE_URL = stored;
      window.__HERMES_REMOTE_READY = true;
      return;
    }
    var disc = await discoverTunnel();
    if (disc) {
      setStored(disc);
      window.__HERMES_REMOTE_URL = disc;
      window.__HERMES_REMOTE_READY = true;
      return;
    }
    showDialog();
  })();

  function showDialog() {
    var el = document.createElement("div");
    el.id = "remote-bridge-overlay";
    el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.97);font-family:system-ui,sans-serif";
    var d = document.createElement("div");
    d.style.cssText = "width:400px;max-width:92vw;padding:32px;border:1px solid #333;border-radius:12px;background:#111";
    d.innerHTML = '<div style="font-size:22px;font-weight:700;color:#eee;margin-bottom:6px">Hermes</div>' +
      '<div style="font-size:14px;color:#777;margin-bottom:28px">Connect to your gateway</div>' +
      '<div style="margin-bottom:18px">' +
      '<label style="display:block;color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:600">Tunnel URL</label>' +
      '<input id="rb-url" type="text" placeholder="https://xxx.trycloudflare.com" style="width:100%;padding:10px 12px;border-radius:6px;background:#000;border:1px solid #333;color:#eee;font-family:monospace;font-size:13px;outline:none;box-sizing:border-box">' +
      '</div><div id="rb-err" style="display:none;color:#f85149;font-size:12px;background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.15);border-radius:6px;padding:8px 12px;margin-bottom:18px"></div>' +
      '<button id="rb-btn" style="width:100%;padding:11px;border-radius:6px;background:#eee;color:#000;font-weight:700;font-size:13px;border:none;cursor:pointer">Connect</button>';
    el.appendChild(d);
    document.body.appendChild(el);
    document.getElementById("rb-btn").onclick = async function() {
      var url = document.getElementById("rb-url").value.replace(/\/+$/, "");
      if (!url) return;
      var btn = document.getElementById("rb-btn");
      btn.textContent = "testing..."; btn.style.opacity = "0.5";
      if (await testUrl(url)) {
        setStored(url); window.__HERMES_REMOTE_URL = url; window.__HERMES_REMOTE_READY = true; el.remove();
      } else {
        var err = document.getElementById("rb-err");
        err.style.display = "block"; err.textContent = "Cannot reach " + url;
        btn.textContent = "Connect"; btn.style.opacity = "1";
      }
    };
    document.getElementById("rb-url").onkeydown = function(e) { if (e.key === "Enter") document.getElementById("rb-btn").click(); };
  }
})();
