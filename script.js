/* ═══════════════════════════════════════════
   FIREBASE SETUP
═══════════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, addDoc, deleteDoc, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDgFIkSHPJVdI5WXQzPUeDNAQpvQtP0Bsg",
  authDomain: "varunworktrack.firebaseapp.com",
  projectId: "varunworktrack",
  storageBucket: "varunworktrack.firebasestorage.app",
  messagingSenderId: "660423634322",
  appId: "1:660423634322:web:115d5e026d534c2a9ea54b"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

/* ═══════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════ */
const DAYS      = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const SHIFT_HRS = 8;
const REG_HRS   = 8;

let empCount = 1;
let EMP      = [];
let MODES    = {};
let editIdx  = -1;

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
const $   = id => document.getElementById(id);
const esc = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ini = n  => n.trim().split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';
const set = (id,v) => { const e=$(id); if(e) e.textContent=v; };

function fmtHM(decHrs){
  const totalMins = Math.round(decHrs * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if(h === 0) return `${m}m`;
  if(m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function show(id){
  ['step1','step2','step3'].forEach(s=>{
    const el=$(s);
    el.classList.remove('show');
    if(s===id) el.classList.add('show');
  });
}
window.show = show;

function toast(msg){
  const t=$('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

function timeToMins(t){
  if(!t) return null;
  const parts = t.split(':');
  if(parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if(isNaN(h)||isNaN(m)) return null;
  return h*60+m;
}

function calcFromTime(inV, outV){
  const a=timeToMins(inV), b=timeToMins(outV);
  if(a===null||b===null) return null;
  let m=b-a; if(m<=0) m+=1440;
  return +(m/60).toFixed(4);
}

/* ═══════════════════════════════════════════
   FIREBASE — SAVE & LOAD
═══════════════════════════════════════════ */
async function saveToCloud() {
  try {
    const savedAt = new Date().toISOString();

    const empSummaries = EMP.map((emp, ei) => {
      const d = getEmpData(ei);
      return {
        name:        emp.name,
        rate:        emp.rate,
        otRate:      emp.otRate || 0,
        daysWorked:  d.days,
        totalHours:  d.totH,
        totalRegH:   d.totRegH,
        totalOtH:    d.totOtH,
        totalRegPay: d.totRegPay,
        totalOtPay:  d.totOtPay,
        totalSalary: d.totSal,
      };
    });

    await setDoc(doc(db, "sessions", "latest"), {
      employees: EMP,
      modes: MODES,
      empCount: empCount,
      savedAt
    });

    await addDoc(collection(db, "history"), {
      employees: empSummaries,
      savedAt
    });

    toast("Saved to cloud ✓");
  } catch(e) {
    toast("Save failed — check connection");
    console.error(e);
  }
}
window.saveToCloud = saveToCloud;

async function loadFromCloud() {
  try {
    const snap = await getDoc(doc(db, "sessions", "latest"));
    if (snap.exists()) {
      const data = snap.data();
      EMP      = data.employees  || [];
      MODES    = data.modes      || {};
      empCount = data.empCount   || 1;
      $('cnum').textContent = empCount;
      if (EMP.length > 0) {
        buildTracker();
        show('step3');
        toast("Data loaded ✓");
      }
    }
  } catch(e) {
    console.log("No saved data:", e);
  }
}

/* ═══════════════════════════════════════════
   SESSION MANAGEMENT
═══════════════════════════════════════════ */
let sessionWatchInterval = null;
const MAX_SESSIONS = 3;

function getDeviceInfo(){
  const ua = navigator.userAgent;
  if(/Android/i.test(ua))     return '📱 Android';
  if(/iPhone|iPad/i.test(ua)) return '📱 iPhone/iPad';
  if(/Windows/i.test(ua))     return '💻 Windows';
  if(/Mac/i.test(ua))         return '💻 Mac';
  if(/Linux/i.test(ua))       return '🖥️ Linux';
  return '🌐 Browser';
}

async function registerSession(userId) {
  try {
    // If this tab already has a valid session, just refresh heartbeat and return
    const existing = sessionStorage.getItem('sessionId');
    if (existing) {
      const snap = await getDoc(doc(db, 'activeSessions', existing));
      if (snap.exists()) {
        setDoc(doc(db, 'activeSessions', existing), {
          userId, loginTime: snap.data().loginTime,
          lastSeen: Date.now(), device: getDeviceInfo()
        }); // no await — fire and forget
        return existing;
      }
      sessionStorage.removeItem('sessionId');
    }

    // Fetch all sessions + register new session IN PARALLEL
    const [snap2, ref] = await Promise.all([
      getDocs(query(collection(db, 'activeSessions'), orderBy('loginTime', 'asc'))),
      addDoc(collection(db, 'activeSessions'), {
        userId,
        loginTime: Date.now(),
        lastSeen: Date.now(),
        device: getDeviceInfo(),
      })
    ]);
    sessionStorage.setItem('sessionId', ref.id);

    const now = Date.now();
    const stale = [];
    const alive = [];

    snap2.docs.forEach(d => {
      if (d.id === ref.id) return; // skip ourselves
      const lastPing = d.data().lastSeen || d.data().loginTime;
      if (now - lastPing > 5 * 60 * 1000) {
        stale.push(d.id);
      } else {
        alive.push({ id: d.id, loginTime: d.data().loginTime });
      }
    });

    // Delete stale sessions in parallel (fire and forget)
    if (stale.length) Promise.all(stale.map(id => deleteDoc(doc(db, 'activeSessions', id))));

    // Add ourselves and sort oldest first
    alive.push({ id: ref.id, loginTime: Date.now() });
    alive.sort((a, b) => a.loginTime - b.loginTime);

    // Kick excess sessions in parallel
    if (alive.length > MAX_SESSIONS) {
      const toKick = alive.slice(0, alive.length - MAX_SESSIONS);
      await Promise.all(toKick.map(s => deleteDoc(doc(db, 'activeSessions', s.id))));
      // If we were kicked (we were among the oldest)
      if (toKick.some(s => s.id === ref.id)) {
        sessionStorage.removeItem('sessionId');
        showKickedModal();
        return null;
      }
    }

    return ref.id;
  } catch(e) {
    console.error('Session register error:', e);
    return null;
  }
}

async function removeOwnSession() {
  try {
    const sessionId = sessionStorage.getItem("sessionId");
    if (sessionId) {
      await deleteDoc(doc(db, "activeSessions", sessionId));
      sessionStorage.removeItem("sessionId");
    }
  } catch(e) {}
}

function startSessionWatch() {
  // Check after 3s on first load (catches kick quickly), then every 90s
  setTimeout(async () => {
    const sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) return;
    const snap = await getDoc(doc(db, "activeSessions", sessionId));
    if (!snap.exists()) { showKickedModal(); return; }
  }, 3000);

  // Every 90s: update heartbeat + check if we were kicked
  sessionWatchInterval = setInterval(async () => {
    try {
      const sessionId = sessionStorage.getItem("sessionId");
      if (!sessionId) return;
      const snap = await getDoc(doc(db, "activeSessions", sessionId));
      if (!snap.exists()) {
        clearInterval(sessionWatchInterval);
        showKickedModal();
        return;
      }
      // Update lastSeen heartbeat so we don't get pruned as stale
      await setDoc(doc(db, "activeSessions", sessionId), {
        ...snap.data(),
        lastSeen: Date.now()
      });
    } catch(e) {}
  }, 90000);
}

function showKickedModal() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(13,17,23,.95);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:Outfit,sans-serif;";
  overlay.innerHTML = `<div style="background:#161b22;border:1px solid #f85149;border-radius:20px;padding:40px 36px;max-width:360px;width:90%;text-align:center;box-shadow:0 8px 48px rgba(248,81,73,.3)"><div style="font-size:2.5rem;margin-bottom:16px">⚠️</div><div style="font-size:1.2rem;font-weight:800;color:#f85149;margin-bottom:12px">Session Ended</div><div style="color:#8b949e;font-size:.9rem;line-height:1.6;margin-bottom:24px">You were signed out because a new device logged in.<br>Maximum <strong style="color:#e6edf3">3 active sessions</strong> allowed at once.</div><button onclick="window.location.href='login.html'" style="width:100%;padding:13px;background:linear-gradient(135deg,#f78166,#ff9f6b);color:#0d1117;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Login Again →</button></div>`;
  document.body.appendChild(overlay);
  setTimeout(() => { window.location.href = "login.html"; }, 8000);
}

window.logout = async function() {
  clearInterval(sessionWatchInterval);
  await removeOwnSession();
  await signOut(auth);
  window.location.href = "login.html";
};

window.addEventListener("beforeunload", () => { removeOwnSession(); });

window.downloadExcel = function() {
  const data = [["Employee","Days Worked","Reg Hrs","OT Hrs","Reg Pay (Rs.)","OT Pay (Rs.)","Total Salary (Rs.)"]];
  EMP.forEach((emp, ei) => {
    const d = getEmpData(ei);
    data.push([emp.name, d.days, d.totRegH.toFixed(2), d.totOtH.toFixed(2),
      d.totRegPay.toFixed(2), d.totOtPay.toFixed(2), d.totSal.toFixed(2)]);
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Weekly Salary");
  XLSX.writeFile(wb, "varun_salary_report.xlsx");
};

/* ═══════════════════════════════════════════
   PDF DOWNLOAD — Tamil/Unicode safe, no DOM interference
═══════════════════════════════════════════ */
window.downloadPDF = function() {
  const date = new Date().toLocaleDateString('en-IN');
  let rows = '';
  let grandTotal = 0;

  EMP.forEach((emp, ei) => {
    const d = getEmpData(ei);
    grandTotal += d.totSal;
    const bg = ei % 2 === 0 ? '#ffffff' : '#f9f9f9';
    rows += `<tr style="background:${bg}">
      <td>${emp.name}</td>
      <td style="text-align:center">${d.days}</td>
      <td style="text-align:center">${d.totRegH.toFixed(1)}</td>
      <td style="text-align:center">${d.totOtH.toFixed(1)}</td>
      <td style="text-align:right">Rs.${d.totRegPay.toFixed(2)}</td>
      <td style="text-align:right">Rs.${d.totOtPay.toFixed(2)}</td>
      <td style="text-align:right;font-weight:bold;color:#1a7a3c">Rs.${d.totSal.toFixed(2)}</td>
    </tr>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Varun Industries — Salary Report</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wdth,wght@75..125,100..900&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Noto Sans Tamil', Arial, sans-serif; margin: 0; padding: 30px; background: white; color: #222; }
  h1 { font-size: 24px; margin: 0 0 4px; color: #1a1a2e; }
  .sub { font-size: 13px; color: #666; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 3px solid #f78166; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f0f0f0; padding: 9px 10px; text-align: left; border-bottom: 2px solid #ccc; }
  td { padding: 8px 10px; border-bottom: 1px solid #e0e0e0; }
  tfoot td { background: #1a1a2e; color: white; font-weight: bold; padding: 10px; }
  tfoot td:last-child { color: #3fb950; font-size: 15px; }
  .footer { margin-top: 20px; font-size: 10px; color: #999; text-align: right; }
  .btn { display: inline-block; margin: 0 0 20px; padding: 10px 22px; background: #f78166; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
  @media print { .btn { display: none; } }
</style>
</head><body>
<button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
<h1>Varun Industries</h1>
<div class="sub">Weekly Salary Report &nbsp;|&nbsp; Date: ${date}</div>
<table>
  <thead><tr>
    <th>Employee Name</th><th>Days</th><th>Reg Hrs</th><th>OT Hrs</th>
    <th style="text-align:right">Reg Pay</th><th style="text-align:right">OT Pay</th><th style="text-align:right">Total Salary</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="6">GRAND TOTAL — ${EMP.length} Employee${EMP.length > 1 ? 's' : ''}</td>
    <td style="text-align:right">Rs.${grandTotal.toFixed(2)}</td>
  </tr></tfoot>
</table>
<div class="footer">Generated by WorkTrack</div>
</body></html>`;

  // Open in new tab — 100% isolated, main page untouched
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.write(html);
    tab.document.close();
  } else {
    toast("Allow popups to open PDF ✓");
  }
  toast("PDF opened in new tab ✓");
};

window.doSummary = function(){ buildSumPane(); switchTab('summary'); };

window.closeEdit = function(){ $('editmodal').classList.remove('open'); editIdx=-1; };
window.saveEdit  = function(){
  const ei=editIdx;
  EMP[ei].name   = $('m-name').value.trim()||EMP[ei].name;
  EMP[ei].rate   = parseFloat($('m-rate').value)||0;
  EMP[ei].otRate = parseFloat($('m-otrate').value)||0;
  const hr=EMP[ei].rate>0?(EMP[ei].rate/SHIFT_HRS).toFixed(2):'—';
  set(`en-${ei}`, EMP[ei].name);
  set(`em-${ei}`, `₹${EMP[ei].rate}/shift · ₹${hr}/hr · 1 shift = ${SHIFT_HRS} hrs${EMP[ei].otRate?' · OT ₹'+EMP[ei].otRate+'/hr':''}`);
  const av=$(`eav-${ei}`); if(av) av.textContent=ini(EMP[ei].name);
  const tb=$(`etab-${ei}`); if(tb) tb.textContent=EMP[ei].name.split(' ')[0];
  window.closeEdit(); toast('Employee updated ✓');
};

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function initApp() {
  $('dec').onclick = () => { empCount=Math.max(1,empCount-1); $('cnum').textContent=empCount; };
  $('inc').onclick = () => { empCount=Math.min(50,empCount+1); $('cnum').textContent=empCount; };
  $('to-step2').onclick = () => { renderSetup(); show('step2'); };

  $('to-step3-btn').onclick = () => {
    EMP=[];
    for(let i=0;i<empCount;i++){
      EMP.push({
        name:   $(`sn-${i}`).value.trim() || `Employee ${i+1}`,
        rate:   parseFloat($(`sr-${i}`).value) || 0,
        otRate: parseFloat($(`so-${i}`).value) || 0,
      });
      if(!MODES[i]) MODES[i]='time';
    }
    buildTracker();
    show('step3');
  };

  $('editmodal').addEventListener('click', e => {
    if(e.target===$('editmodal')) window.closeEdit();
  });

  document.addEventListener('input', function(e){
    if(e.target && (e.target.id.startsWith('otexm-') || e.target.id.startsWith('softm-'))){
      let v = parseInt(e.target.value);
      if(isNaN(v) || v < 0) { e.target.value=''; return; }
      if(v > 60)             { e.target.value=60;  return; }
      e.target.value = v;
    }
  });

  const scrollTop = $('scroll-top');
  const scrollBot = $('scroll-bottom');
  window.addEventListener('scroll',()=>{
    if(window.scrollY>200) scrollTop.classList.add('vis');
    else scrollTop.classList.remove('vis');
  },{passive:true});
  scrollTop.onclick = ()=>window.scrollTo({top:0,behavior:'smooth'});
  scrollBot.onclick = ()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});

  window.autoOT = function(i){
    const rate = parseFloat($(`sr-${i}`)?.value)||0;
    const otField = $(`so-${i}`);
    if(otField && rate > 0) otField.value = (rate / SHIFT_HRS).toFixed(2);
    else if(otField) otField.value = '';
  };

  startSessionWatch();
  loadFromCloud();
}

/* ═══════════════════════════════════════════
   FIREBASE AUTH CHECK
═══════════════════════════════════════════ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    // Start app immediately — session registration runs in background
    initApp();
    registerSession(user.uid); // no await — doesn't block app load
  }
});

/* ═══════════════════════════════════════════
   STEP 2 — RENDER SETUP CARDS
═══════════════════════════════════════════ */
function renderSetup(){
  $('step2lbl').textContent = `${empCount} Employee${empCount>1?'s':''}`;
  let html='';
  for(let i=0;i<empCount;i++){
    const p=EMP[i]||{};
    html+=`
    <div class="setupcard">
      <div class="empbadge">Employee ${i+1}</div>
      <div style="margin-bottom:12px;margin-top:6px;">
        <label class="fl">Full Name</label>
        <input class="fi" id="sn-${i}" type="text" placeholder="e.g. Sivakumar" value="${esc(p.name||'')}">
      </div>
      <div class="frow">
        <div class="fg">
          <label class="fl">Salary / Shift (₹)</label>
          <input class="fi" id="sr-${i}" type="number" placeholder="e.g. 650" min="0" value="${p.rate||''}" oninput="autoOT(${i})">
        </div>
        <div class="fg">
          <label class="fl">OT Rate / Hour (₹) <span style="color:var(--green);font-size:.65rem;letter-spacing:0">(auto)</span></label>
          <input class="fi" id="so-${i}" type="number" placeholder="auto" min="0" value="${p.otRate||''}">
        </div>
      </div>
    </div>`;
  }
  $('setup-grid').innerHTML=html;
}

/* ═══════════════════════════════════════════
   STEP 3 — BUILD TRACKER
═══════════════════════════════════════════ */
function buildTracker(){
  $('tb-info').innerHTML = `<b>${EMP.length}</b> Employee${EMP.length>1?'s':''} &nbsp;·&nbsp; Mon – Sat`;
  const tabs=$('emptabs'), body=$('trackerbody');
  tabs.innerHTML=''; body.innerHTML='';

  EMP.forEach((emp,ei)=>{
    if(!MODES[ei]) MODES[ei]='time';
    const t=document.createElement('button');
    t.className='etab'+(ei===0?' on':'');
    t.id=`etab-${ei}`; t.dataset.tab=`emp-${ei}`;
    t.textContent=emp.name.split(' ')[0];
    t.onclick=()=>switchTab(`emp-${ei}`);
    tabs.appendChild(t);

    const p=document.createElement('div');
    p.className='tpane'+(ei===0?' on':'');
    p.id=`pane-emp-${ei}`;
    p.innerHTML=buildPane(ei);
    body.appendChild(p);
  });

  // Event delegation on stable parent — listeners survive any inner re-render
  body.addEventListener('click', function(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.id;
    if (!id) return;
    const calcTime  = id.match(/^calcbtn-time-(\d+)$/);
    const calcShift = id.match(/^calcbtn-shift-(\d+)$/);
    const editBtn   = id.match(/^editbtn-(\d+)$/);
    const modeTime  = id.match(/^mb-time-(\d+)$/);
    const modeShift = id.match(/^mb-shift-(\d+)$/);
    if (calcTime)  { doCalcTime(+calcTime[1]);       return; }
    if (calcShift) { doCalcShift(+calcShift[1]);     return; }
    if (editBtn)   { openEdit(+editBtn[1]);           return; }
    if (modeTime)  { setMode(+modeTime[1], 'time');  return; }
    if (modeShift) { setMode(+modeShift[1], 'shift'); return; }
  });

  const st=document.createElement('button');
  st.className='etab stab'; st.dataset.tab='summary';
  st.textContent='📊 Summary';
  st.onclick=()=>{ buildSumPane(); switchTab('summary'); };
  tabs.appendChild(st);

  const sp=document.createElement('div');
  sp.className='tpane'; sp.id='pane-summary';
  sp.innerHTML=`<div style="padding:60px;text-align:center;color:var(--muted)">Click <strong style="color:var(--blue)">📊 Summary</strong> to view all employee weekly report.</div>`;
  body.appendChild(sp);
}

/* ─── BUILD SINGLE EMPLOYEE PANE ─── */
function buildPane(ei){
  const emp  = EMP[ei];
  const mode = MODES[ei];
  const hr   = emp.rate>0 ? (emp.rate/SHIFT_HRS).toFixed(2) : '—';

  const timeRows = DAYS.map((day,di)=>
    `<tr class="${day==='Saturday'?'satrow':''}">
      <td class="dname${day==='Saturday'?' sat':''}">${day}</td>
      <td><input class="tin" type="time" id="tin-${ei}-${di}"></td>
      <td><input class="tin" type="time" id="tout-${ei}-${di}"></td>
      <td>
        <div style="display:flex;align-items:center;gap:4px;">
          <input class="otin" type="number" id="otex-${ei}-${di}" placeholder="0" min="0" max="23" step="1" style="width:52px;">
          <span style="font-size:.72rem;color:var(--muted);">h</span>
          <input class="otin" type="number" id="otexm-${ei}-${di}" placeholder="0" min="0" max="60" step="1" style="width:52px;">
          <span style="font-size:.72rem;color:var(--muted);">m</span>
        </div>
      </td>
      <td id="td-rh-${ei}-${di}"><span class="tag muted">—</span></td>
      <td id="td-oth-${ei}-${di}"><span class="tag muted">—</span></td>
      <td id="td-sal-${ei}-${di}"><span class="tag muted">—</span></td>
    </tr>`).join('');

  const shiftRows = DAYS.map((day,di)=>
    `<tr class="${day==='Saturday'?'satrow':''}">
      <td class="dname${day==='Saturday'?' sat':''}">${day}</td>
      <td>
        <input class="nin" type="number" id="sft-${ei}-${di}" placeholder="0" min="0" step="0.5">
        <span style="font-size:.72rem;color:var(--muted);margin-left:5px;">shifts</span>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:4px;">
          <input class="otin" type="number" id="soft-${ei}-${di}" placeholder="0" min="0" max="23" step="1" style="width:52px;">
          <span style="font-size:.72rem;color:var(--muted);">h</span>
          <input class="otin" type="number" id="softm-${ei}-${di}" placeholder="0" min="0" max="60" step="1" style="width:52px;">
          <span style="font-size:.72rem;color:var(--muted);">m</span>
        </div>
      </td>
      <td id="sd-rh-${ei}-${di}"><span class="tag muted">—</span></td>
      <td id="sd-oth-${ei}-${di}"><span class="tag muted">—</span></td>
      <td id="sd-sal-${ei}-${di}"><span class="tag muted">—</span></td>
    </tr>`).join('');

  return `
  <div class="emphead">
    <div class="emavatar" id="eav-${ei}">${ini(emp.name)}</div>
    <div>
      <div class="emname" id="en-${ei}">${esc(emp.name)}</div>
      <div class="emmeta" id="em-${ei}">
        ₹${emp.rate}/shift &nbsp;·&nbsp; ₹${hr}/hr &nbsp;·&nbsp; 1 shift = ${SHIFT_HRS} hrs
        ${emp.otRate ? `&nbsp;·&nbsp; OT ₹${emp.otRate}/hr` : ''}
      </div>
    </div>
    <div class="em-right">
      <button class="editbtn" id="editbtn-${ei}">✏️ Edit</button>
    </div>
  </div>

  <div class="modetoggle">
    <button class="modebtn${mode==='time'?' on':''}" id="mb-time-${ei}">🕐 In / Out Time</button>
    <button class="modebtn${mode==='shift'?' on':''}" id="mb-shift-${ei}">📋 Shift Count</button>
  </div>

  <div id="sec-time-${ei}" style="display:${mode==='time'?'block':'none'}">
    <div class="entrycard">
      <div class="entrycardh">
        <div>
          <div class="entrycardtitle">🕐 In / Out Time — Monday to Saturday</div>
          <div class="entrycardsub">Enter clock-in and clock-out for each working day.</div>
        </div>
        <button class="calcbtn" id="calcbtn-time-${ei}">⚡ Calculate Salary</button>
      </div>
      <div class="scroll-hint">← Scroll left/right →</div>
      <div class="tscroll"><table class="tt">
        <thead><tr>
          <th>Day</th><th>In Time</th><th>Out Time</th>
          <th>Extra OT Hrs</th><th>Reg Hours</th><th>OT Hours</th><th>Day Salary</th>
        </tr></thead>
        <tbody>${timeRows}</tbody>
      </table></div>
    </div>
  </div>

  <div id="sec-shift-${ei}" style="display:${mode==='shift'?'block':'none'}">
    <div class="entrycard">
      <div class="entrycardh">
        <div>
          <div class="entrycardtitle">📋 Shift Count — Monday to Saturday</div>
          <div class="entrycardsub">Enter number of shifts worked per day. 1 shift = 8 hrs.</div>
        </div>
        <button class="calcbtn" id="calcbtn-shift-${ei}">⚡ Calculate Salary</button>
      </div>
      <div class="scroll-hint">← Scroll left/right →</div>
      <div class="tscroll"><table class="tt">
        <thead><tr>
          <th>Day</th><th>Shifts Worked</th><th>Extra OT Hrs</th>
          <th>Reg Hours</th><th>OT Hours</th><th>Day Salary</th>
        </tr></thead>
        <tbody>${shiftRows}</tbody>
      </table></div>
    </div>
  </div>

  <div id="res-${ei}" style="display:none">
    <div class="rescards">
      <div class="rescard blue">
        <div class="rclbl">Total Hours / Week</div>
        <div class="rcval bl" id="rc-totH-${ei}">0</div>
        <div class="rcsub">Regular + OT combined</div>
      </div>
      <div class="rescard">
        <div class="rclbl">Regular Hours</div>
        <div class="rcval" id="rc-regH-${ei}">0</div>
        <div class="rcsub">≤ ${REG_HRS} hrs/day</div>
      </div>
      <div class="rescard purple">
        <div class="rclbl">Overtime Hours</div>
        <div class="rcval pu" id="rc-otH-${ei}">0</div>
        <div class="rcsub">&gt; ${REG_HRS} hrs/day + extra</div>
      </div>
      <div class="rescard">
        <div class="rclbl">Days Worked</div>
        <div class="rcval" id="rc-days-${ei}">0</div>
        <div class="rcsub">Out of 6 days</div>
      </div>
      <div class="rescard gold">
        <div class="rclbl">Regular Pay</div>
        <div class="rcval go" id="rc-regPay-${ei}">₹0</div>
        <div class="rcsub">Shift-based pay</div>
      </div>
      <div class="rescard purple">
        <div class="rclbl">OT Pay</div>
        <div class="rcval pu" id="rc-otPay-${ei}">₹0</div>
        <div class="rcsub">OT hrs × ₹${emp.otRate||0}/hr</div>
      </div>
      <div class="rescard green">
        <div class="rclbl">Total Salary / Week</div>
        <div class="rcval gr" id="rc-totSal-${ei}">₹0</div>
        <div class="rcsub">Regular + OT pay</div>
      </div>
      <div class="rescard accent">
        <div class="rclbl">Hourly Rate</div>
        <div class="rcval ac" id="rc-hr-${ei}">₹ ${hr}</div>
        <div class="rcsub">Per hour (regular)</div>
      </div>
    </div>
    <div class="weektable">
      <div class="weektableh">📅 Per-Day Breakdown</div>
      <div class="scroll-hint">← Scroll left/right →</div>
      <div class="tscroll"><table class="wt">
        <thead><tr>
          <th>Day</th><th>Entry</th>
          <th>Reg Hrs</th><th>OT Hrs</th>
          <th>Reg Pay</th><th>OT Pay</th><th>Day Total</th>
        </tr></thead>
        <tbody id="wt-body-${ei}"></tbody>
      </table></div>
    </div>
  </div>`;
}

/* ─── MODE SWITCH ─── */
function setMode(ei, mode){
  MODES[ei]=mode;
  $(`sec-time-${ei}`).style.display  = mode==='time'  ? 'block':'none';
  $(`sec-shift-${ei}`).style.display = mode==='shift' ? 'block':'none';
  $(`mb-time-${ei}`).classList.toggle('on', mode==='time');
  $(`mb-shift-${ei}`).classList.toggle('on', mode==='shift');
  $(`res-${ei}`).style.display='none';
}

/* ─── CALCULATE: TIME MODE ─── */
function doCalcTime(ei){
  const emp=EMP[ei];
  let totH=0, totRegH=0, totOtH=0, totRegPay=0, totOtPay=0, days=0;
  const rows=[];
  for(let di=0;di<6;di++){
    const iv    = $(`tin-${ei}-${di}`)?.value;
    const ov    = $(`tout-${ei}-${di}`)?.value;
    const exOTh = parseFloat($(`otex-${ei}-${di}`)?.value)||0;
    const exOTm = parseFloat($(`otexm-${ei}-${di}`)?.value)||0;
    const exOT  = exOTh + (exOTm/60);
    const worked = calcFromTime(iv,ov);
    if(worked!==null || exOT>0){
      const regH   = Math.min(worked||0, REG_HRS);
      const otH    = Math.max(0,(worked||0)-REG_HRS)+exOT;
      const regPay = (regH/SHIFT_HRS)*emp.rate;
      const otPay  = otH*(emp.otRate||0);
      const dayTot = regPay+otPay;
      $(`td-rh-${ei}-${di}`).innerHTML  = `<span class="tag blue">${fmtHM(regH)}</span>`;
      $(`td-oth-${ei}-${di}`).innerHTML = otH>0?`<span class="tag purple">${fmtHM(otH)}</span>`:`<span class="tag muted">—</span>`;
      $(`td-sal-${ei}-${di}`).innerHTML = `<span class="tag green">₹ ${dayTot.toFixed(2)}</span>`;
      totH+=(worked||0)+exOT; totRegH+=regH; totOtH+=otH; totRegPay+=regPay; totOtPay+=otPay; days++;
      rows.push({day:DAYS[di], entry:`${iv} → ${ov}`, regH, otH, regPay, otPay, dayTot});
    } else {
      $(`td-rh-${ei}-${di}`).innerHTML  = `<span class="tag muted">No entry</span>`;
      $(`td-oth-${ei}-${di}`).innerHTML = `<span class="tag muted">—</span>`;
      $(`td-sal-${ei}-${di}`).innerHTML = `<span class="tag muted">—</span>`;
    }
  }
  showResults(ei, totH, totRegH, totOtH, totRegPay, totOtPay, days, rows);
}

/* ─── CALCULATE: SHIFT MODE ─── */
function doCalcShift(ei){
  const emp=EMP[ei];
  let totH=0, totRegH=0, totOtH=0, totRegPay=0, totOtPay=0, days=0;
  const rows=[];
  for(let di=0;di<6;di++){
    const sf    = parseFloat($(`sft-${ei}-${di}`)?.value)||0;
    const exOTh = parseFloat($(`soft-${ei}-${di}`)?.value)||0;
    const exOTm = parseFloat($(`softm-${ei}-${di}`)?.value)||0;
    const exOT  = exOTh+(exOTm/60);
    if(sf>0||exOT>0){
      const worked = sf*SHIFT_HRS;
      const regH   = Math.min(worked,REG_HRS);
      const otH    = Math.max(0,worked-REG_HRS)+exOT;
      const regPay = (regH/SHIFT_HRS)*emp.rate;
      const otPay  = otH*(emp.otRate||0);
      const dayTot = regPay+otPay;
      $(`sd-rh-${ei}-${di}`).innerHTML  = `<span class="tag blue">${fmtHM(regH)}</span>`;
      $(`sd-oth-${ei}-${di}`).innerHTML = otH>0?`<span class="tag purple">${fmtHM(otH)}</span>`:`<span class="tag muted">—</span>`;
      $(`sd-sal-${ei}-${di}`).innerHTML = `<span class="tag green">₹ ${dayTot.toFixed(2)}</span>`;
      const entry=`${sf} shift${sf!==1?'s':''}${exOT>0?' +'+fmtHM(exOT)+' OT':''}`;
      totH+=worked+exOT; totRegH+=regH; totOtH+=otH; totRegPay+=regPay; totOtPay+=otPay; days++;
      rows.push({day:DAYS[di],entry,regH,otH,regPay,otPay,dayTot});
    } else {
      $(`sd-rh-${ei}-${di}`).innerHTML  = `<span class="tag muted">No entry</span>`;
      $(`sd-oth-${ei}-${di}`).innerHTML = `<span class="tag muted">—</span>`;
      $(`sd-sal-${ei}-${di}`).innerHTML = `<span class="tag muted">—</span>`;
    }
  }
  showResults(ei, totH, totRegH, totOtH, totRegPay, totOtPay, days, rows);
}

/* ─── SHOW RESULTS ─── */
function showResults(ei,totH,totRegH,totOtH,totRegPay,totOtPay,days,rows){
  const totSal=totRegPay+totOtPay;
  set(`rc-totH-${ei}`,   fmtHM(totH));
  set(`rc-regH-${ei}`,   fmtHM(totRegH));
  set(`rc-otH-${ei}`,    fmtHM(totOtH));
  set(`rc-days-${ei}`,   days+'');
  set(`rc-regPay-${ei}`, '₹ '+totRegPay.toFixed(2));
  set(`rc-otPay-${ei}`,  '₹ '+totOtPay.toFixed(2));
  set(`rc-totSal-${ei}`, '₹ '+totSal.toFixed(2));
  set(`rc-hr-${ei}`,     '₹ '+(EMP[ei].rate>0?(EMP[ei].rate/SHIFT_HRS).toFixed(2):'—'));

  let tbody = rows.map(r=>`<tr>
    <td style="font-weight:700">${r.day}</td>
    <td style="color:var(--muted);font-size:.8rem">${r.entry}</td>
    <td><span class="tag blue">${fmtHM(r.regH)}</span></td>
    <td>${r.otH>0?`<span class="tag purple">${fmtHM(r.otH)}</span>`:`<span class="tag muted">—</span>`}</td>
    <td style="color:var(--gold);font-weight:600">₹ ${r.regPay.toFixed(2)}</td>
    <td style="color:var(--purple);font-weight:600">${r.otH>0?'₹ '+r.otPay.toFixed(2):'—'}</td>
    <td><span class="tag green">₹ ${r.dayTot.toFixed(2)}</span></td>
  </tr>`).join('');

  tbody+=`<tr class="wt-totrow">
    <td colspan="2" style="color:var(--blue)">WEEKLY TOTAL</td>
    <td style="color:var(--blue)">${fmtHM(totRegH)}</td>
    <td style="color:var(--purple)">${fmtHM(totOtH)}</td>
    <td style="color:var(--gold)">₹ ${totRegPay.toFixed(2)}</td>
    <td style="color:var(--purple)">₹ ${totOtPay.toFixed(2)}</td>
    <td style="color:var(--green)">₹ ${totSal.toFixed(2)}</td>
  </tr>`;

  $(`wt-body-${ei}`).innerHTML=tbody;
  $(`res-${ei}`).style.display='block';
  $(`res-${ei}`).scrollIntoView({behavior:'smooth',block:'nearest'});
  toast(`${EMP[ei].name} — Salary calculated ✓`);
}

/* ─── EDIT MODAL ─── */
function openEdit(ei){
  editIdx=ei; const e=EMP[ei];
  $('m-name').value=e.name; $('m-rate').value=e.rate; $('m-otrate').value=e.otRate||'';
  $('editmodal').classList.add('open');
}

/* ─── SUMMARY PANE ─── */
function getEmpData(ei){
  const emp=EMP[ei]; const mode=MODES[ei];
  let totH=0,totRegH=0,totOtH=0,totRegPay=0,totOtPay=0,days=0;
  const rows=[];
  for(let di=0;di<6;di++){
    let regH=0,otH=0,entry='';
    if(mode==='time'){
      const iv=$(`tin-${ei}-${di}`)?.value, ov=$(`tout-${ei}-${di}`)?.value;
      const exOTh=parseFloat($(`otex-${ei}-${di}`)?.value)||0;
      const exOTm=parseFloat($(`otexm-${ei}-${di}`)?.value)||0;
      const exOT=exOTh+(exOTm/60);
      const w=calcFromTime(iv,ov);
      if(w===null&&exOT===0) continue;
      regH=Math.min(w||0,REG_HRS); otH=Math.max(0,(w||0)-REG_HRS)+exOT;
      entry=`${iv||'?'} → ${ov||'?'}`;
    } else {
      const sf=parseFloat($(`sft-${ei}-${di}`)?.value)||0;
      const exOTh=parseFloat($(`soft-${ei}-${di}`)?.value)||0;
      const exOTm=parseFloat($(`softm-${ei}-${di}`)?.value)||0;
      const exOT=exOTh+(exOTm/60);
      if(sf===0&&exOT===0) continue;
      const w=sf*SHIFT_HRS;
      regH=Math.min(w,REG_HRS); otH=Math.max(0,w-REG_HRS)+exOT;
      entry=`${sf} shift${sf!==1?'s':''}`;
    }
    const regPay=(regH/SHIFT_HRS)*emp.rate, otPay=otH*(emp.otRate||0);
    totH+=regH+otH; totRegH+=regH; totOtH+=otH; totRegPay+=regPay; totOtPay+=otPay; days++;
    rows.push({day:DAYS[di],entry,regH,otH,regPay,otPay,dayTot:regPay+otPay});
  }
  return {totH,totRegH,totOtH,totRegPay,totOtPay,totSal:totRegPay+totOtPay,days,rows};
}

function buildSumPane(){
  let sumcards='',mrows='',drows='';
  let gH=0,gRegH=0,gOtH=0,gRegPay=0,gOtPay=0,gSal=0;
  EMP.forEach((emp,ei)=>{
    const d=getEmpData(ei);
    gH+=d.totH; gRegH+=d.totRegH; gOtH+=d.totOtH; gRegPay+=d.totRegPay; gOtPay+=d.totOtPay; gSal+=d.totSal;
    const hr=emp.rate>0?(emp.rate/SHIFT_HRS).toFixed(2):'—';
    sumcards+=`<div class="sumempcard">
      <div class="sumemphdr">
        <div class="sumav">${ini(emp.name)}</div>
        <div><div class="sumn">${esc(emp.name)}</div>
        <div class="sumr">₹${emp.rate}/shift · ₹${hr}/hr${emp.otRate?' · OT ₹'+emp.otRate+'/hr':''} · ${MODES[ei]==='time'?'In/Out Time':'Shift Count'}</div></div>
      </div>
      <div class="sumbody">
        <div class="sumrow"><span class="ll">Days worked</span><span class="vv">${d.days} / 6</span></div>
        <div class="sumrow"><span class="ll">Total hours</span><span class="vv b">${fmtHM(d.totH)}</span></div>
        <div class="sumrow"><span class="ll">Regular hours</span><span class="vv gd">${fmtHM(d.totRegH)}</span></div>
        <div class="sumrow"><span class="ll">Overtime hours</span><span class="vv pu">${fmtHM(d.totOtH)}</span></div>
        <div class="sumrow"><span class="ll">Regular pay</span><span class="vv gd">₹ ${d.totRegPay.toFixed(2)}</span></div>
        <div class="sumrow"><span class="ll">OT pay</span><span class="vv pu">₹ ${d.totOtPay.toFixed(2)}</span></div>
        <div class="sumrow" style="padding-top:8px"><span class="ll"><strong>Total salary</strong></span><span class="vv big">₹ ${d.totSal.toFixed(2)}</span></div>
      </div></div>`;
    mrows+=`<tr>
      <td class="mtn">${esc(emp.name)}</td><td style="color:var(--muted)">₹${emp.rate}</td><td>${d.days}</td>
      <td class="mth">${fmtHM(d.totH)}</td><td class="mth">${fmtHM(d.totRegH)}</td><td class="mto">${fmtHM(d.totOtH)}</td>
      <td style="color:var(--gold);font-weight:600">₹ ${d.totRegPay.toFixed(2)}</td>
      <td class="mto">₹ ${d.totOtPay.toFixed(2)}</td><td class="mts">₹ ${d.totSal.toFixed(2)}</td></tr>`;
    d.rows.forEach(r=>{
      drows+=`<tr><td class="mtn">${esc(emp.name)}</td><td style="font-weight:600">${r.day}</td>
        <td style="color:var(--muted);font-size:.8rem">${r.entry}</td>
        <td class="mth">${fmtHM(r.regH)}</td><td class="mto">${r.otH>0?fmtHM(r.otH):'—'}</td>
        <td style="color:var(--gold)">₹ ${r.regPay.toFixed(2)}</td>
        <td class="mto">${r.otH>0?'₹ '+r.otPay.toFixed(2):'—'}</td>
        <td class="mts">₹ ${r.dayTot.toFixed(2)}</td></tr>`;
    });
  });
  mrows+=`<tr class="grandrow"><td colspan="3">GRAND TOTAL — ${EMP.length} Employee${EMP.length>1?'s':''}</td>
    <td>${fmtHM(gH)}</td><td>${fmtHM(gRegH)}</td><td>${fmtHM(gOtH)}</td>
    <td>₹ ${gRegPay.toFixed(2)}</td><td>₹ ${gOtPay.toFixed(2)}</td><td>₹ ${gSal.toFixed(2)}</td></tr>`;

  $('pane-summary').innerHTML=`
    <div class="sumtitle">Employee Weekly Summary</div>
    <div class="sumcards">${sumcards||'<p style="color:var(--muted)">No data yet. Press ⚡ Calculate on each tab first.</p>'}</div>
    <div class="sumtitle">Master Salary Statement</div>
    <div class="mastercard" style="margin-bottom:24px">
      <div class="masterhdr">📋 WEEKLY SALARY — ALL EMPLOYEES</div>
      <div class="scroll-hint">← Scroll left/right →</div><div class="tscroll"><table class="mt">
        <thead><tr><th>Name</th><th>Rate/Shift</th><th>Days</th><th>Total Hrs</th><th>Reg Hrs</th><th>OT Hrs</th><th>Reg Pay</th><th>OT Pay</th><th>Total Salary</th></tr></thead>
        <tbody>${mrows}</tbody></table></div></div>
    <div class="sumtitle">Daily Attendance Breakdown</div>
    <div class="mastercard">
      <div class="masterhdr">📅 PER-DAY DETAIL — ALL EMPLOYEES</div>
      <div class="scroll-hint">← Scroll left/right →</div><div class="tscroll"><table class="mt">
        <thead><tr><th>Name</th><th>Day</th><th>Entry</th><th>Reg Hrs</th><th>OT Hrs</th><th>Reg Pay</th><th>OT Pay</th><th>Day Total</th></tr></thead>
        <tbody>${drows||'<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--muted)">No data yet. Press ⚡ Calculate on each employee tab first.</td></tr>'}</tbody>
      </table></div></div>`;
}

/* ─── TAB SWITCH ─── */
function switchTab(id){
  document.querySelectorAll('.etab').forEach(t=>t.classList.toggle('on',t.dataset.tab===id));
  document.querySelectorAll('.tpane').forEach(p=>p.classList.toggle('on',p.id===`pane-${id}`));
}
