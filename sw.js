var CACHE = "bettingbrain-v16";
var FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
var API = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
var STATE_CACHE = "bb-state";
var STATE_KEY = "./__bb-state.json";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== STATE_CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  if (u.pathname.indexOf("__bb-state") >= 0) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var c = r.clone(); caches.open(CACHE).then(function (ch) { ch.put(e.request, c); }); return r;
  }).catch(function () { return caches.match(e.request).then(function (h) { return h || caches.match("./index.html"); }); }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if ("focus" in cs[i]) return cs[i].focus();
    return self.clients.openWindow("./index.html");
  }));
});

/* ---------- hali ya kufuata mechi (inatumwa na app) ---------- */
function saveState(s) {
  return caches.open(STATE_CACHE).then(function (c) {
    return c.put(STATE_KEY, new Response(JSON.stringify(s), { headers: { "Content-Type": "application/json" } }));
  });
}
function loadState() {
  return caches.open(STATE_CACHE).then(function (c) { return c.match(STATE_KEY); })
    .then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
}
self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type === "bb-state") e.waitUntil(saveState({ follow: d.follow || {}, prev: d.prev || {}, notif: !!d.notif, en: !!d.en }));
});

/* ---------- arifa zikiwa app imefungwa ---------- */
function pad(n) { return (n < 10 ? "0" : "") + n; }
function ymd(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
function show(title, body, tag) {
  return self.registration.showNotification(title, {
    body: body, icon: "icon-192.png", badge: "icon-192.png", tag: tag || "bb", renotify: true, vibrate: [200, 100, 200]
  });
}
function appVisible() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    return cs.some(function (c) { return c.visibilityState === "visible"; });
  }).catch(function () { return false; });
}
function checkGoals() {
  return Promise.all([loadState(), appVisible()]).then(function (r) {
    var s = r[0], visible = r[1];
    if (!s || !s.notif || visible) return;
    var ids = Object.keys(s.follow || {});
    if (!ids.length) return;
    var en = !!s.en;
    var jobs = [0, -1].map(function (i) {
      var d = new Date(); d.setDate(d.getDate() + i);
      return fetch(API + "all/scoreboard?dates=" + ymd(d), { cache: "no-store" }).then(function (x) { return x.json(); }).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (res) {
      var prev = s.prev || {}, out = [];
      res.forEach(function (j) {
        if (!j) return;
        (j.events || []).forEach(function (e) {
          var id = String(e.id);
          if (!s.follow[id]) return;
          var c = (e.competitions && e.competitions[0]) || {}, h = null, a = null;
          (c.competitors || []).forEach(function (x) { if (x.homeAway === "home") h = x; else if (x.homeAway === "away") a = x; });
          if (!h || !a || !h.team || !a.team) return;
          var ty = ((e.status || c.status || {}).type) || {}, st = ty.state || "pre";
          var hs = parseInt(h.score, 10) || 0, as = parseInt(a.score, 10) || 0;
          var hn = h.team.shortDisplayName || h.team.displayName || "?", an = a.team.shortDisplayName || a.team.displayName || "?";
          var nm = hn + " " + hs + " - " + as + " " + an, p = prev[id];
          if (p) {
            if (p.state === "pre" && st === "in") out.push(["▶ " + (en ? "Kick-off" : "Mechi imeanza"), hn + " vs " + an, id]);
            if (hs > p.hs || as > p.as) out.push(["⚽ " + (en ? "GOAL!" : "GOLI!") + " " + (ty.shortDetail || ""), nm, id]);
            else if (hs < p.hs || as < p.as) out.push([en ? "Goal disallowed (VAR)" : "Goli limeondolewa (VAR)", nm, id]);
            if (p.state === "in" && st === "post") out.push(["🏁 " + (en ? "Full time" : "Mechi imeisha"), nm, id]);
          }
          prev[id] = { hs: hs, as: as, state: st };
        });
      });
      s.prev = prev;
      return saveState(s).then(function () {
        return Promise.all(out.map(function (n) { return show(n[0], n[1], n[2]); }));
      });
    });
  });
}
self.addEventListener("periodicsync", function (e) {
  if (e.tag === "bb-goals") e.waitUntil(checkGoals());
});
self.addEventListener("sync", function (e) {
  if (e.tag === "bb-goals") e.waitUntil(checkGoals());
});

/* ---------- push kutoka server (ikiwa utaweka server ya push baadaye) ---------- */
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { body: e.data.text() }; } catch (y) {} }
  e.waitUntil(show(d.title || "Betting Brain", d.body || "", d.tag || "bb-push"));
});
