/* Powerwall & Solar Payback — offline calculator */
(function () {
  "use strict";

  const R = window.__RATES__;
  if (!R) {
    document.body.innerHTML = "<p style='padding:2rem;color:#fb7185'>rates.json missing — rebuild.</p>";
    return;
  }

  const DEFAULTS = {
    sqft: R.example_home.sqft,
    monthlyKwh: R.example_home.monthly_kwh,
    solarKw: 8,
    pwCount: 1,
    planId: "schedule_r",
    criticalKw: R.example_home.critical_load_kw,
    applyItc: true,
    shiftTou: true,
  };

  const state = { ...DEFAULTS };
  const $ = (id) => document.getElementById(id);
  const fmt$ = (n) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const fmt2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

  function planById(id) {
    return R.plans.find((p) => p.id === id) || R.plans[0];
  }

  function monthsInSeason(season) {
    return season === "summer" ? 4 : 8;
  }

  /** Approximate all-in volumetric $/kWh for Schedule R (flat). */
  function flatVolRate(plan, seasonKey) {
    const s = plan.seasons[seasonKey];
    return (
      plan.delivery_usd_per_kwh +
      (plan.empower_usd_per_kwh || 0) +
      s.generation_usd_per_kwh +
      s.transmission_usd_per_kwh
    );
  }

  /** TOU volumetric all-in by period. */
  function touVolRate(plan, seasonKey, period) {
    const s = plan.seasons[seasonKey][period];
    return (
      plan.delivery_usd_per_kwh +
      (plan.empower_usd_per_kwh || 0) +
      s.generation_usd_per_kwh +
      s.transmission_usd_per_kwh
    );
  }

  /** EXAMPLE load-weighted average rate for a plan + optional battery peak shifting. */
  function avgRate(plan, shiftTou) {
    if (plan.kind === "flat") {
      const summer = flatVolRate(plan, "summer");
      const winter = flatVolRate(plan, "winter");
      // weight by months
      return (summer * 4 + winter * 8) / 12;
    }
    const split = plan.example_load_split;
    let sum = 0;
    for (const season of ["summer", "winter"]) {
      const months = monthsInSeason(season);
      let s = split[season];
      // With battery TOU shift: move half of on-peak into off-peak (EXAMPLE)
      if (shiftTou && state.pwCount > 0) {
        const move = s.on_peak * 0.5;
        s = {
          on_peak: s.on_peak - move,
          intermediate: s.intermediate,
          off_peak: s.off_peak + move,
        };
      }
      const rate =
        touVolRate(plan, season, "on_peak") * s.on_peak +
        touVolRate(plan, season, "intermediate") * s.intermediate +
        touVolRate(plan, season, "off_peak") * s.off_peak;
      sum += rate * months;
    }
    return sum / 12;
  }

  function annualKwh() {
    return state.monthlyKwh * 12;
  }

  function solarAnnualKwh() {
    const per = R.hardware_examples.solar.annual_kwh_per_kw;
    return state.solarKw * per;
  }

  function batteryKwh() {
    return state.pwCount * R.hardware_examples.powerwall.usable_kwh;
  }

  function systemCost() {
    const hw = R.hardware_examples;
    const solar = state.solarKw * 1000 * hw.solar.cost_per_watt_usd;
    const bat = state.pwCount * hw.powerwall.installed_cost_usd_each;
    const gross = solar + bat;
    const itc = state.applyItc ? gross * hw.incentives.federal_itc_fraction : 0;
    return { solar, bat, gross, itc, net: Math.max(0, gross - itc) };
  }

  function compute() {
    const plan = planById(state.planId);
    const rate = avgRate(plan, state.shiftTou);
    const rateNoShift = avgRate(plan, false);
    const kwh = annualKwh();
    const solarKwh = Math.min(solarAnnualKwh(), kwh * 1.05); // cap near load (NEM EXAMPLE)
    const offsetKwh = Math.min(solarKwh, kwh);
    const remainingKwh = Math.max(0, kwh - offsetKwh);

    // Battery TOU arbitrage value (EXAMPLE): if on RL + shift, extra cents on shifted kWh
    let arbitrage = 0;
    if (plan.kind === "tou" && state.shiftTou && state.pwCount > 0) {
      const cyclesPerYear = Math.min(300, 365);
      const usablePerCycle = Math.min(
        batteryKwh() * 0.85,
        state.monthlyKwh * 0.15
      );
      // rough on-peak vs off-peak delta (winter on vs off all-in)
      const on = touVolRate(plan, "winter", "on_peak");
      const off = touVolRate(plan, "winter", "off_peak");
      arbitrage = usablePerCycle * cyclesPerYear * Math.max(0, on - off) * 0.6;
    }

    const customerYear = plan.customer_charge_usd_month * 12;
    const billBefore = kwh * rateNoShift + customerYear;
    const billAfterVol = remainingKwh * rate;
    // SREC EXAMPLE credit
    const srec =
      (solarKwh / 1000) * R.hardware_examples.incentives.md_srec_usd_per_mwh;
    const billAfter = billAfterVol + customerYear - arbitrage - srec * 0.5;
    const annualSavings = Math.max(0, billBefore - Math.max(0, billAfter));

    const cost = systemCost();
    const payback =
      annualSavings > 50 ? cost.net / annualSavings : Infinity;

    const outageHours =
      state.criticalKw > 0 ? (batteryKwh() * 0.95) / state.criticalKw : 0;

    return {
      plan,
      rate,
      rateNoShift,
      kwh,
      solarKwh,
      offsetKwh,
      remainingKwh,
      billBefore,
      billAfter: Math.max(0, billAfter),
      annualSavings,
      arbitrage,
      srec,
      cost,
      payback,
      outageHours,
      batteryKwh: batteryKwh(),
    };
  }

  /* ---------- charts ---------- */
  function svgPayback(c) {
    const years = 20;
    const W = 560, H = 260, pad = { t: 24, r: 20, b: 36, l: 52 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    let cum = -c.cost.net;
    const pts = [{ y: 0, v: cum }];
    for (let i = 1; i <= years; i++) {
      cum += c.annualSavings;
      pts.push({ y: i, v: cum });
    }
    const minV = Math.min(...pts.map((p) => p.v), 0);
    const maxV = Math.max(...pts.map((p) => p.v), 1);
    const x = (i) => pad.l + (i / years) * iw;
    const y = (v) => pad.t + ih - ((v - minV) / (maxV - minV)) * ih;
    const zeroY = y(0);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.y)},${y(p.v)}`).join(" ");
    const area =
      `M${x(0)},${zeroY} ` +
      pts.map((p) => `L${x(p.y)},${y(p.v)}`).join(" ") +
      ` L${x(years)},${zeroY} Z`;
    const payY = Number.isFinite(c.payback) ? Math.min(c.payback, years) : null;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative payback chart">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line class="chart-axis" x1="${pad.l}" y1="${zeroY}" x2="${W - pad.r}" y2="${zeroY}"/>
      <path class="chart-area" d="${area}"/>
      <path class="chart-line" d="${line}"/>
      ${payY != null ? `<line class="chart-line2" x1="${x(payY)}" y1="${pad.t}" x2="${x(payY)}" y2="${H - pad.b}"/>
        <text class="chart-label" x="${x(payY) + 4}" y="${pad.t + 12}">payback ~${fmt1(c.payback)}y</text>` : ""}
      <text class="chart-label" x="${pad.l}" y="${H - 8}">yr 0</text>
      <text class="chart-label" x="${W - pad.r - 24}" y="${H - 8}">yr ${years}</text>
      <text class="chart-label" x="4" y="${y(maxV) + 4}">${fmt$(maxV)}</text>
      <text class="chart-label" x="4" y="${y(minV)}">${fmt$(minV)}</text>
    </svg>`;
  }

  function svgSavings(c) {
    const years = 12;
    const W = 560, H = 240, pad = { t: 16, r: 16, b: 32, l: 48 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxS = Math.max(c.annualSavings, 1);
    const bw = iw / years - 6;
    let bars = "";
    for (let i = 0; i < years; i++) {
      // mild EXAMPLE escalation 2%/yr on savings display
      const sav = c.annualSavings * Math.pow(1.02, i);
      const h = (sav / (maxS * Math.pow(1.02, years - 1))) * ih;
      const bx = pad.l + i * (iw / years) + 3;
      const by = pad.t + ih - h;
      bars += `<rect class="chart-bar" x="${bx}" y="${by}" width="${bw}" height="${h}" rx="3"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Annual savings bars">
      ${bars}
      <text class="chart-label" x="${pad.l}" y="${H - 8}">yr 1</text>
      <text class="chart-label" x="${W - pad.r - 28}" y="${H - 8}">yr ${years}</text>
      <text class="chart-label" x="4" y="${pad.t + 8}">${fmt$(maxS * Math.pow(1.02, years - 1))}</text>
    </svg>`;
  }

  function svgOutage(c) {
    const loads = [1, 1.5, 2, 3, 4, 5, 6];
    const hours = loads.map((kw) => (c.batteryKwh * 0.95) / kw);
    const W = 560, H = 220, pad = { t: 16, r: 16, b: 40, l: 40 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxH = Math.max(...hours, 1);
    const bw = iw / loads.length - 10;
    let bars = "";
    loads.forEach((kw, i) => {
      const h = (hours[i] / maxH) * ih;
      const bx = pad.l + i * (iw / loads.length) + 5;
      const by = pad.t + ih - h;
      const active = Math.abs(kw - state.criticalKw) < 0.3;
      bars += `<rect class="chart-bar${active ? "" : " dim"}" x="${bx}" y="${by}" width="${bw}" height="${h}" rx="3"/>
        <text class="chart-label" x="${bx + bw / 2}" y="${H - 22}" text-anchor="middle">${kw} kW</text>
        <text class="chart-label" x="${bx + bw / 2}" y="${by - 4}" text-anchor="middle">${fmt1(hours[i])}h</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outage hours by load">${bars}</svg>`;
  }

  function gaugeSvg(hours) {
    const max = 48;
    const pct = Math.min(1, hours / max);
    const r = 48, cx = 60, cy = 60;
    const circ = 2 * Math.PI * r * 0.75;
    const dash = circ * pct;
    return `<svg class="gauge" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"
        stroke-dasharray="${circ} ${circ}" stroke-dashoffset="${circ * 0.125}" transform="rotate(135 ${cx} ${cy})"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#34d399" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${circ * 0.125}" transform="rotate(135 ${cx} ${cy})"/>
    </svg>`;
  }

  /* ---------- render ---------- */
  function renderKpis(c) {
    const pb =
      Number.isFinite(c.payback) && c.payback < 100
        ? fmt1(c.payback) + " yr"
        : "n/a";
    $("paybackPill").textContent = pb + " payback";
    $("planPill").textContent = c.plan.name.split("—")[0].trim();
    $("kpiGrid").innerHTML = `
      <div class="kpi gold"><div class="k">Payback</div><div class="v">${pb}</div><div class="s">net cost ÷ annual savings</div></div>
      <div class="kpi green"><div class="k">Annual savings</div><div class="v">${fmt$(c.annualSavings)}</div><div class="s">vs EXAMPLE bill before</div></div>
      <div class="kpi blue"><div class="k">Outage cover</div><div class="v">${fmt1(c.outageHours)} h</div><div class="s">at ${fmt1(state.criticalKw)} kW critical</div></div>
      <div class="kpi"><div class="k">Net system cost</div><div class="v">${fmt$(c.cost.net)}</div><div class="s">EXAMPLE${state.applyItc ? " after ITC" : ""}</div></div>`;
  }

  function renderBills(c) {
    const max = Math.max(c.billBefore, c.billAfter, 1);
    $("billBars").innerHTML = `
      <div class="bill-row before"><span>Before</span><div class="bar-track"><div class="bar-fill" style="width:${(c.billBefore / max) * 100}%"></div></div><span class="amt">${fmt$(c.billBefore)}/yr</span></div>
      <div class="bill-row"><span>After</span><div class="bar-track"><div class="bar-fill" style="width:${(c.billAfter / max) * 100}%"></div></div><span class="amt">${fmt$(c.billAfter)}/yr</span></div>`;
    $("billNote").textContent =
      `Blended volumetric ~${(c.rate * 100).toFixed(1)}¢/kWh on ${c.plan.name}. Solar offsets ~${Math.round(c.offsetKwh)} kWh/yr (EXAMPLE MD yield). SREC/arbitrage are EXAMPLE credits.`;
  }

  function renderQuick(c) {
    const parts = [];
    if (state.solarKw <= 0 && state.pwCount <= 0) {
      parts.push("Add solar and/or a Powerwall to see savings and outage cover.");
    } else {
      if (Number.isFinite(c.payback) && c.payback < 20) {
        parts.push(
          `At these EXAMPLE inputs, net payback is about ${fmt1(c.payback)} years under ${c.plan.name.split("—")[0].trim()}.`
        );
      } else if (Number.isFinite(c.payback)) {
        parts.push(
          `Payback stretches past 20 years at current EXAMPLE costs — try more solar, TOU + shift, or lower $/W.`
        );
      } else {
        parts.push("Savings too small to estimate payback — increase solar or battery shift.");
      }
      if (c.plan.kind === "tou" && state.pwCount > 0 && state.shiftTou) {
        parts.push("TOU peak-shifting is on, which improves RL economics in this model.");
      }
      if (c.outageHours >= 8) {
        parts.push(`Battery covers ~${fmt1(c.outageHours)} hours of ${fmt1(state.criticalKw)} kW critical load.`);
      }
    }
    $("quickRead").textContent = parts.join(" ");
  }

  function renderCharts(c) {
    $("paybackChart").innerHTML = svgPayback(c);
    $("savingsChart").innerHTML = svgSavings(c);
    const pb =
      Number.isFinite(c.payback) && c.payback < 100
        ? `Simple payback ≈ ${fmt1(c.payback)} years (EXAMPLE costs, no discount rate).`
        : "Payback not reached within modeled horizon at these inputs.";
    $("paybackNote").textContent = pb;

    const maxCost = Math.max(c.cost.gross, 1);
    $("costStack").innerHTML = `
      <div class="cost-row"><span>Solar (EXAMPLE)</span><div class="track"><div class="fill solar" style="width:${(c.cost.solar / maxCost) * 100}%"></div></div><span class="amt">${fmt$(c.cost.solar)}</span></div>
      <div class="cost-row"><span>Battery (EXAMPLE)</span><div class="track"><div class="fill bat" style="width:${(c.cost.bat / maxCost) * 100}%"></div></div><span class="amt">${fmt$(c.cost.bat)}</span></div>
      <div class="cost-row"><span>ITC credit</span><div class="track"><div class="fill itc" style="width:${(c.cost.itc / maxCost) * 100}%"></div></div><span class="amt">−${fmt$(c.cost.itc)}</span></div>
      <div class="cost-row"><span>Net</span><div class="track"><div class="fill net" style="width:${(c.cost.net / maxCost) * 100}%"></div></div><span class="amt">${fmt$(c.cost.net)}</span></div>`;
  }

  function renderOutage(c) {
    $("outageHero").innerHTML = `
      ${gaugeSvg(c.outageHours)}
      <div><div class="outage-big">${fmt1(c.outageHours)} <span>hours</span></div>
      <p class="hint">${fmt1(c.batteryKwh)} kWh usable · ${fmt1(state.criticalKw)} kW critical · EXAMPLE</p></div>`;
    $("outageChart").innerHTML = svgOutage(c);
    const loads = [1, 1.5, 2, 2.5, 3, 4, 5, 6];
    const tb = $("outageTable").querySelector("tbody");
    tb.innerHTML = loads
      .map((kw) => {
        const h = (c.batteryKwh * 0.95) / kw;
        const hi = Math.abs(kw - state.criticalKw) < 0.01 ? ' style="color:#34d399;font-weight:700"' : "";
        return `<tr${hi}><td>${fmt1(kw)} kW</td><td>${fmt1(h)} h</td><td>${fmt2(h / 24)} d</td></tr>`;
      })
      .join("");
  }

  function renderPlans(c) {
    const kwh = annualKwh();
    $("planCards").innerHTML = R.plans
      .map((p) => {
        const rate = avgRate(p, state.shiftTou && p.kind === "tou");
        const bill = kwh * rate + p.customer_charge_usd_month * 12;
        const active = p.id === state.planId ? " active" : "";
        const badge = p.verified
          ? '<span class="badge">public tariff snapshot</span>'
          : '<span class="badge example">EXAMPLE</span>';
        let extra = "";
        if (p.kind === "flat") {
          extra = `<dt>Summer gen</dt><dd>${(p.seasons.summer.generation_usd_per_kwh * 100).toFixed(2)}¢</dd>
            <dt>Winter gen</dt><dd>${(p.seasons.winter.generation_usd_per_kwh * 100).toFixed(2)}¢</dd>
            <dt>Delivery</dt><dd>${(p.delivery_usd_per_kwh * 100).toFixed(2)}¢</dd>`;
        } else {
          extra = `<dt>Winter on-peak</dt><dd>${(touVolRate(p, "winter", "on_peak") * 100).toFixed(1)}¢ all-in</dd>
            <dt>Winter off-peak</dt><dd>${(touVolRate(p, "winter", "off_peak") * 100).toFixed(1)}¢ all-in</dd>
            <dt>Customer</dt><dd>$${p.customer_charge_usd_month}/mo</dd>`;
        }
        return `<div class="plan-card${active}">
          ${badge}
          <h3>${p.name}</h3>
          <dl>
            <dt>EXAMPLE annual bill</dt><dd>${fmt$(bill)}</dd>
            <dt>Blended ¢/kWh</dt><dd>${(rate * 100).toFixed(1)}¢</dd>
            ${extra}
          </dl>
        </div>`;
      })
      .join("");

    const rl = planById("schedule_rl");
    const rp = rl.rating_periods;
    $("touGrid").innerHTML = `
      <div class="tou-card"><h4>Summer (Jun–Sep)</h4>
        <ul>
          <li><strong>On-peak:</strong> ${rp.summer.on_peak}</li>
          <li><strong>Intermediate:</strong> ${rp.summer.intermediate}</li>
          <li><strong>Off-peak:</strong> ${rp.summer.off_peak}</li>
        </ul>
      </div>
      <div class="tou-card"><h4>Non-summer (Oct–May)</h4>
        <ul>
          <li><strong>On-peak:</strong> ${rp.winter.on_peak}</li>
          <li><strong>Intermediate:</strong> ${rp.winter.intermediate}</li>
          <li><strong>Off-peak:</strong> ${rp.winter.off_peak}</li>
        </ul>
      </div>`;
  }

  function renderAbout() {
    $("srcList").innerHTML = R.meta.sources
      .map(
        (s) =>
          `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a> — ${s.notes}</li>`
      )
      .join("");
    $("footMeta").textContent = `rates compiled ${R.meta.compiled_at} · ${R.meta.disclaimer.slice(0, 48)}…`;
  }

  function renderAll() {
    const c = compute();
    renderKpis(c);
    renderBills(c);
    renderQuick(c);
    renderCharts(c);
    renderOutage(c);
    renderPlans(c);
  }

  /* ---------- routing ---------- */
  const VIEWS = ["home", "charts", "outage", "plans", "about"];

  function showView(name) {
    if (!VIEWS.includes(name)) name = "home";
    VIEWS.forEach((v) => {
      const el = $("view-" + v);
      const tab = document.querySelector(`.tab[data-view="${v}"]`);
      const on = v === name;
      if (el) {
        el.classList.toggle("active", on);
        el.hidden = !on;
      }
      if (tab) {
        tab.classList.toggle("active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      }
    });
    if (location.hash.replace(/^#/, "") !== name) {
      history.replaceState(null, "", "#" + name);
    }
  }

  function bind() {
    const map = [
      ["sqft", "sqftOut", (v) => String(v)],
      ["monthlyKwh", "monthlyKwhOut", (v) => String(v)],
      ["solarKw", "solarKwOut", (v) => fmt1(+v)],
      ["pwCount", "pwCountOut", (v) => String(v)],
      ["criticalKw", "criticalKwOut", (v) => fmt1(+v)],
    ];
    map.forEach(([id, out, fmt]) => {
      const el = $(id);
      el.addEventListener("input", () => {
        state[id === "monthlyKwh" ? "monthlyKwh" : id === "solarKw" ? "solarKw" : id === "pwCount" ? "pwCount" : id === "criticalKw" ? "criticalKw" : "sqft"] =
          id === "pwCount" ? +el.value : +el.value;
        // normalize keys
        if (id === "sqft") state.sqft = +el.value;
        if (id === "monthlyKwh") state.monthlyKwh = +el.value;
        if (id === "solarKw") state.solarKw = +el.value;
        if (id === "pwCount") state.pwCount = +el.value;
        if (id === "criticalKw") state.criticalKw = +el.value;
        $(out).textContent = fmt(el.value);
        renderAll();
      });
    });

    const sel = $("ratePlan");
    R.plans.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.value = state.planId;
    sel.addEventListener("change", () => {
      state.planId = sel.value;
      renderAll();
    });

    $("applyItc").addEventListener("change", (e) => {
      state.applyItc = e.target.checked;
      renderAll();
    });
    $("shiftTou").addEventListener("change", (e) => {
      state.shiftTou = e.target.checked;
      renderAll();
    });

    $("btnReset").addEventListener("click", () => {
      Object.assign(state, DEFAULTS);
      $("sqft").value = state.sqft;
      $("sqftOut").textContent = state.sqft;
      $("monthlyKwh").value = state.monthlyKwh;
      $("monthlyKwhOut").textContent = state.monthlyKwh;
      $("solarKw").value = state.solarKw;
      $("solarKwOut").textContent = fmt1(state.solarKw);
      $("pwCount").value = state.pwCount;
      $("pwCountOut").textContent = state.pwCount;
      $("criticalKw").value = state.criticalKw;
      $("criticalKwOut").textContent = fmt1(state.criticalKw);
      $("ratePlan").value = state.planId;
      $("applyItc").checked = state.applyItc;
      $("shiftTou").checked = state.shiftTou;
      renderAll();
    });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => showView(tab.dataset.view));
    });
    window.addEventListener("hashchange", () => {
      showView(location.hash.replace(/^#/, "") || "home");
    });
  }

  bind();
  renderAbout();
  renderAll();
  showView(location.hash.replace(/^#/, "") || "home");
})();
