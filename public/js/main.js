/* Joshy Bloom — site behaviour.
   Four small independent pieces, each a no-op when its markup is absent:
   temperature, reveals, parallax, events. No dependencies. */

(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;

  /* --- temperature ------------------------------------------------------
     Sections declare data-temp. Whichever one owns the middle of the
     viewport wins, and its palette is promoted onto <html>, where the
     colour tokens cross-fade. */
  function initTemperature() {
    const zones = document.querySelectorAll("[data-temp-zone]");
    if (!zones.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            root.dataset.temp = entry.target.dataset.tempZone;
          }
        }
      },
      // A 1px band across the middle of the viewport: only one zone can
      // intersect it at a time, so the active temperature is unambiguous.
      { rootMargin: "-50% 0px -50% 0px" }
    );

    zones.forEach((zone) => observer.observe(zone));
  }

  /* --- reveals ----------------------------------------------------------
     One-shot. Elements stay revealed once seen. */
  function initReveals() {
    const targets = document.querySelectorAll(".reveal, .hero");
    if (!targets.length) return;

    if (reduceMotion.matches) {
      targets.forEach((el) => el.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          obs.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );

    targets.forEach((el) => observer.observe(el));
  }

  /* --- parallax ---------------------------------------------------------
     The bleed image is 115% tall and drifts within its frame. Transform
     only, rAF-coalesced, and skipped entirely under reduced motion. */
  function initParallax() {
    const layers = Array.from(document.querySelectorAll("[data-parallax]"));
    if (!layers.length || reduceMotion.matches) return;

    let ticking = false;

    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      for (const layer of layers) {
        const frame = layer.parentElement;
        const rect = frame.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vh) continue;
        // -1 when the frame is entering, +1 when it is leaving.
        const progress = (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2);
        const shift = progress * (Number(layer.dataset.parallax) || 6);
        layer.style.transform = `translate3d(0, ${shift.toFixed(2)}%, 0)`;
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    update();
  }

  /* --- events -----------------------------------------------------------
     Calendar page only. The events are already in the HTML; this just orders
     them and retires the ones that have been and gone. Nothing is fetched, so
     the page works from file://, offline, and with JavaScript disabled. */

  const startOf = (li) => {
    const el = li.querySelector(".event__date");
    // A <time datetime> asserts a real date; data-sort is only an ordering
    // hint for entries whose date has not been announced.
    const raw = el?.getAttribute("datetime") || el?.dataset.sort;
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isNaN(t) ? null : t;
  };

  // A run stays current until its final day, not its opening one.
  const endOf = (li) => {
    const until = li.querySelector(".event__date")?.dataset.until;
    const t = until ? Date.parse(until) : NaN;
    return Number.isNaN(t) ? startOf(li) : t;
  };

  function initEvents() {
    const upcomingList = document.querySelector("[data-events='upcoming']");
    if (!upcomingList) return;

    const pastList = document.querySelector("[data-events='past']");
    const status = document.querySelector("[data-events-status]");
    const entries = Array.from(upcomingList.children);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today.getTime();

    const upcoming = [];
    const past = [];
    for (const li of entries) {
      const end = endOf(li);
      (end !== null && end < cutoff ? past : upcoming).push(li);
    }

    // Confirmed and estimated dates in order; anything undated trails.
    upcoming.sort((a, b) => {
      const at = startOf(a);
      const bt = startOf(b);
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return at - bt;
    });
    past.sort((a, b) => (endOf(b) ?? 0) - (endOf(a) ?? 0));

    upcoming.forEach((li) => upcomingList.append(li));

    if (past.length && pastList) {
      past.forEach((li) => {
        li.querySelector(".event")?.classList.add("event--past");
        pastList.append(li);
      });
      const archive = pastList.closest("[data-archive]");
      if (archive) archive.hidden = false;
    }

    if (!upcoming.length && status) {
      status.textContent =
        "No dates announced at the moment. New work and performances are posted to Instagram first.";
      status.hidden = false;
    }
  }

  /* --- boot -------------------------------------------------------------- */

  initTemperature();
  initReveals();
  initParallax();
  initEvents();

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();
})();
