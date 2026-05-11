import { Component, useState, useEffect, useRef } from "react";
import {
  Heart, Sun, Moon, Plus, ChevronLeft, ChevronRight, Check, X,
  Pencil, LogOut, CalendarIcon, Flag, Star, Briefcase, FileText,
  Users, ImageIcon, Cake,
} from "lucide-react";
import { auth, provider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, setDoc
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { getHolidayForDate, MY_HOLIDAYS } from "./holidays";
import "./index.css";

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const DEFAULT_ANNUAL_EVENTS = [
  { id: "annual-anniversary-0101", title: "在一起纪念日", date: "2025-01-01", type: "anniversary", owner: null, repeat: true, allDay: true, note: "" },
  { id: "annual-birthday-him-0202", title: "YH 生日 🎂", date: "2025-02-02", type: "anniversary", owner: "him", repeat: true, allDay: true, note: "" },
  { id: "annual-birthday-sy-1026", title: "SY 生日 🎂", date: "2025-10-26", type: "anniversary", owner: "her", repeat: true, allDay: true, note: "" },
];

const DEFAULT_SCHOOL_EVENTS = [
  { id: "inti-2026-05-18", title: "Mid Semester Break", date: "2026-05-18", endDate: "2026-05-24", type: "assign", schoolType: "break", owner: "her", source: "school", locked: true },
  { id: "inti-2026-07-13", title: "Study Break", date: "2026-07-13", endDate: "2026-07-15", type: "assign", schoolType: "break", owner: "her", source: "school", locked: true },
  { id: "inti-2026-07-16", title: "Final Examination", date: "2026-07-16", endDate: "2026-07-24", type: "assign", schoolType: "exam", owner: "her", source: "school", locked: true },
  { id: "inti-2026-08-07", title: "Release of Results", date: "2026-08-07", endDate: "2026-08-11", type: "assign", schoolType: "results", owner: "her", source: "school", locked: true },
];

const ALLOWED_EMAILS = new Set(["chinyihang06@gmail.com", "shinyutoo@gmail.com"]);

const LIMITS = {
  title: 90,
  note: 180,
  imageBytes: 2 * 1024 * 1024,
  schoolRangeDays: 180,
};
const ALLOWED_TYPES = new Set(["work", "assign", "social", "together", "anniversary"]);
const ALLOWED_SCHOOL_TYPES = new Set(["exam", "break", "results"]);
const ALLOWED_OWNERS = new Set(["him", "her"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function storageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in strict/private browser modes.
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, max = 120) {
  return String(value || "")
    .split("")
    .map(char => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(y, m - 1, d);
  return check.getFullYear() === y && check.getMonth() === m - 1 && check.getDate() === d;
}

function daysBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}

function safeImageSrc(src) {
  if (!src) return null;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)) return src;
  if (/^https:\/\/firebasestorage\.googleapis\.com\//i.test(src)) return src;
  if (/^https:\/\/storage\.googleapis\.com\//i.test(src)) return src;
  return null;
}

function normalizeEventInput(data, user) {
  const type = ALLOWED_TYPES.has(data.type) ? data.type : "work";
  const title = cleanText(data.title, LIMITS.title);
  const note = cleanText(data.note, LIMITS.note);
  const date = isDateString(data.date) ? data.date : null;
  if (!title || !date) return null;
  const endDate = isDateString(data.endDate) && data.endDate > date ? data.endDate : null;
  const isMultiDay = Boolean(endDate);
  const shared = type === "together" || type === "anniversary";
  return {
    title,
    date,
    endDate,
    type,
    owner: shared ? null : "him",
    ownerEmail: cleanText(user?.email, 120),
    note,
    allDay: isMultiDay ? true : Boolean(data.allDay),
    time: (isMultiDay || data.allDay) || !/^\d{2}:\d{2}$/.test(String(data.time || "")) ? null : data.time,
    repeat: Boolean(data.repeat && type === "anniversary"),
    photo: safeImageSrc(data.photo),
  };
}

function normalizeSchoolInput(data) {
  const title = cleanText(data.title, LIMITS.title);
  const date = isDateString(data.date) ? data.date : null;
  const endDate = data.endDate && isDateString(data.endDate) && data.endDate >= data.date && daysBetween(data.date, data.endDate) <= LIMITS.schoolRangeDays
    ? data.endDate
    : null;
  const schoolType = ALLOWED_SCHOOL_TYPES.has(data.schoolType) ? data.schoolType : "exam";
  const owner = ALLOWED_OWNERS.has(data.owner) ? data.owner : "her";
  if (!title || !date) return null;
  return {
    title,
    date,
    endDate,
    type: "assign",
    schoolType,
    owner,
    source: "school",
    allDay: true,
  };
}

function cleanStoredEvents(value) {
  return safeArray(value).map(item => {
    const normalized = normalizeEventInput(item, { email: item?.ownerEmail || "" });
    return normalized ? { ...normalized, id: cleanText(item.id, 80) || crypto.randomUUID(), createdAt: Number(item.createdAt) || Date.now() } : null;
  }).filter(Boolean);
}

function cleanStoredSchoolEvents(value) {
  return safeArray(value).map(item => {
    const normalized = normalizeSchoolInput(item);
    return normalized ? { ...normalized, id: cleanText(item.id, 80) || crypto.randomUUID(), createdAt: Number(item.createdAt) || Date.now() } : null;
  }).filter(Boolean);
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  resetLocalData = () => {
    storageRemove("events");
    storageRemove("schoolEvents");
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-screen">
          <div className="crash-card">
            <div className="modal-title">页面数据需要刷新</div>
            <p>本地缓存里有旧格式数据，清理后就能重新进入日历。</p>
            <button className="btn-submit" onClick={this.resetLocalData}>清理本地缓存并重开</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function toDs(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayDs() { return toDs(new Date()); }

function evClass(e) {
  if (e.source === "school") return "school";
  if (e.type === "anniversary") return "anniversary";
  if (e.type === "together") return "together";
  if (e.type === "holiday") return "holiday";
  return e.owner || "him";
}

const TYPE_ICONS = {
  work: <Briefcase size={16} />, assign: <FileText size={16} />, social: <Users size={16} />,
  together: <Heart size={16} />, anniversary: <Star size={16} />, holiday: <Flag size={16} />,
  school: <FileText size={16} />,
};

function fmtDate(s) {
  const [y,m,d] = s.split("-").map(Number);
  const days = ["日","一","二","三","四","五","六"];
  return `${m}月${d}日 星期${days[new Date(y,m-1,d).getDay()]}`;
}

function getEventsForDs(s, events) {
  const [,m,d] = s.split("-").map(Number);
  const all = [];
  events.forEach(e => {
    if (e.date === s) { all.push(e); return; }
    if (e.endDate && s >= e.date && s <= e.endDate) {
      all.push({ ...e, startDate: e.date, date: s });
      return;
    }
    if (e.repeat) {
      const [,em,ed] = e.date.split("-").map(Number);
      if (Number(em) === m && Number(ed) === d) all.push({ ...e, date: s });
    }
  });
  return all;
}

function LoginScreen({ onLogin }) {
  return (
    <div className="login-screen">
      <div className="login-aura login-aura-one" />
      <div className="login-aura login-aura-two" />
      <div className="login-card">
        <div className="login-mark">
          <span />
          <Heart size={20} fill="currentColor" />
        </div>
        <div className="login-title">Calendar</div>
        <div className="login-sub">Plans, dates, and reminders.</div>
        <button className="btn-google" onClick={onLogin}>
          <GoogleLogo /> Continue with Google
        </button>
      </div>
    </div>
  );
}

function NoPermissionScreen({ onLogout }) {
  return (
    <div className="login-screen">
      <div className="login-aura login-aura-one" />
      <div className="login-aura login-aura-two" />
      <div className="login-card">
        <div className="login-mark">
          <span />
          <Heart size={20} fill="currentColor" />
        </div>
        <div style={{fontSize:28,fontWeight:700,color:"#2c2c3a",margin:"8px 0 10px"}}>No Permission</div>
        <div className="login-sub" style={{marginBottom:24}}>This account is not authorized to access this calendar.</div>
        <button className="btn-google" onClick={onLogout}>
          Exit
        </button>
      </div>
    </div>
  );
}

function TimerBanner({ togetherDate, onEdit }) {
  const start = new Date(togetherDate); start.setHours(0,0,0,0);
  const now = new Date(); now.setHours(0,0,0,0);
  const days = Math.round((now - start) / 86400000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  const dateObj = new Date(togetherDate);
  let sub = `${dateObj.getFullYear()}年${dateObj.getMonth()+1}月${dateObj.getDate()}日 · `;
  if (years > 0) sub += `${years} 年 ${months % 12} 个月`;
  else if (months > 0) sub += `${months} 个月`;
  else sub += "刚刚开始";
  return (
    <div className="timer-banner">
      <div className="timer-left">
        <div className="timer-heart"><Heart size={20} fill="currentColor" /></div>
        <div>
          <div className="timer-label">我们在一起</div>
          <div className="timer-count"><span>{days}</span> 天</div>
          <div className="timer-sub">{sub}</div>
        </div>
      </div>
    </div>
  );
}

const CD_DAYS = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
function fmtCdDate(dateStr, showYear = false) {
  const [y,m,d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m-1, d).getDay();
  return showYear ? `${y}年${m}月${d}日 ${CD_DAYS[dow]}` : `${m}月${d}日 ${CD_DAYS[dow]}`;
}

function Countdowns({ events }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = toDs(today);
  const y = today.getFullYear();
  const items = [];

  [
    { id: "annual-birthday-sy-1026", label: "SY 生日" },
    { id: "annual-birthday-him-0202", label: "YH 生日" },
  ].forEach(({ id, label }) => {
    const ev = DEFAULT_ANNUAL_EVENTS.find(e => e.id === id);
    if (!ev) return;
    const [,em,ed] = ev.date.split("-").map(Number);
    let next = new Date(y, em-1, ed); next.setHours(0,0,0,0);
    if (next < today) next = new Date(y+1, em-1, ed);
    const days = Math.round((next - today) / 86400000);
    const dateStr = `${next.getFullYear()}-${String(em).padStart(2,'0')}-${String(ed).padStart(2,'0')}`;
    items.push({ label, name: null, dateStr, days, cat:"anniversary", icon:<Cake size={15} />, showYear: true });
  });

  const nextPublic = MY_HOLIDAYS.filter(h => h.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date))[0];
  const nextBreak = events
    .filter(e => e.source === "school" && e.schoolType === "break" && (e.endDate || e.date) >= todayStr)
    .sort((a,b) => a.date.localeCompare(b.date))[0];

  let nextH = null;
  if (nextPublic && nextBreak) {
    nextH = nextBreak.date <= nextPublic.date
      ? { name: nextBreak.title, dateStr: nextBreak.date }
      : { name: nextPublic.name, dateStr: nextPublic.date };
  } else if (nextBreak) {
    nextH = { name: nextBreak.title, dateStr: nextBreak.date };
  } else if (nextPublic) {
    nextH = { name: nextPublic.name, dateStr: nextPublic.date };
  }
  if (nextH) {
    const days = Math.max(0, Math.round((new Date(nextH.dateStr + "T00:00:00") - today) / 86400000));
    items.push({ label:"下个假期", name: nextH.name, dateStr: nextH.dateStr, days, cat:"holiday", icon:<Flag size={15} /> });
  }

  const nextT = events.filter(e => e.type==="together").map(e => {
    const d2 = new Date(e.date + "T00:00:00"); d2.setHours(0,0,0,0);
    return { ...e, diff: Math.round((d2-today)/86400000) };
  }).filter(e => e.diff >= 0).sort((a,b) => a.diff-b.diff)[0];
  if (nextT) items.push({ label:"下次约会", name:nextT.title, dateStr: nextT.date, days:nextT.diff, cat:"together", icon:<Heart size={15} /> });

  if (!items.length) return null;
  const count = Math.min(items.length, 4);
  return (
    <div className="countdowns" style={{gridTemplateColumns:`repeat(${count}, 1fr)`}}>
      {items.slice(0,4).map((c,i) => (
        <div key={i} className={`cd-card ${c.cat}`}>
          <div className="cd-top"><div className="cd-icon">{c.icon}</div><div className="cd-label">{c.label}</div></div>
          {c.name && <div className="cd-name">{c.name}</div>}
          <div className="cd-date-row">{fmtCdDate(c.dateStr, c.showYear)}</div>
          <div className="cd-countdown">
            {c.days === 0 ? <span className="cd-today">今天！</span>
              : <><span className="cd-pre">还有</span><span className="cd-num">{c.days}</span><span className="cd-suf">天</span></>}
          </div>
        </div>
      ))}
    </div>
  );
}

const MIN_YEAR = 2025;
const MAX_YEAR = 2030;

function MonthPicker({ curDate, onSelect, onClose }) {
  const MONTHS = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
  const [pickerYear, setPickerYear] = useState(curDate.getFullYear());
  return (
    <div className="month-picker-overlay" onClick={e => { if (e.target.classList.contains("month-picker-overlay")) onClose(); }}>
      <div className="month-picker">
        <div className="month-picker-nav">
          <button className="cal-nav-btn" onClick={() => setPickerYear(y => Math.max(MIN_YEAR, y-1))} disabled={pickerYear <= MIN_YEAR}><ChevronLeft size={16} /></button>
          <span className="month-picker-year">{pickerYear}年</span>
          <button className="cal-nav-btn" onClick={() => setPickerYear(y => Math.min(MAX_YEAR, y+1))} disabled={pickerYear >= MAX_YEAR}><ChevronRight size={16} /></button>
        </div>
        <div className="month-picker-grid">
          {MONTHS.map((name, i) => {
            const isCur = pickerYear === curDate.getFullYear() && i === curDate.getMonth();
            return (
              <button key={i} className={`month-pill${isCur ? " active" : ""}`}
                onClick={() => { onSelect(new Date(pickerYear, i, 1)); onClose(); }}>
                {name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Calendar({ curDate, events, selDate, onSelectDay, onChangeMonth, onJumpTo }) {
  const y = curDate.getFullYear(), m = curDate.getMonth();
  const MONTHS = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
  const [showPicker, setShowPicker] = useState(false);
  const first = new Date(y,m,1).getDay();
  const dim = new Date(y,m+1,0).getDate();
  const dipm = new Date(y,m,0).getDate();
  const today = todayDs();
  const total = Math.ceil((first+dim)/7)*7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    let day, off = 0;
    if (i < first) { day = dipm-first+i+1; off = -1; }
    else if (i >= first+dim) { day = i-first-dim+1; off = 1; }
    else day = i-first+1;
    const s = toDs(new Date(y, m+off, day));
    const evts = getEventsForDs(s, events);
    const holiday = getHolidayForDate(s);
    cells.push({ day, off, s, evts, holiday });
  }
  return (
    <div className="cal-card">
      {showPicker && <MonthPicker curDate={curDate} onSelect={onJumpTo} onClose={() => setShowPicker(false)} />}
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => onChangeMonth(-1)}><ChevronLeft size={18} /></button>
        <h2 className="cal-title-btn" onClick={() => setShowPicker(true)}>{y}年 {MONTHS[m]}</h2>
        <button className="cal-nav-btn" onClick={() => onChangeMonth(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="weekdays">
        {["日","一","二","三","四","五","六"].map(d => <div key={d} className="weekday">{d}</div>)}
      </div>
      <div className="days-grid">
        {cells.map(({ day, off, s, evts, holiday }) => {
          let cls = "day-cell";
          if (off !== 0) cls += " other-month";
          if (s === today) cls += " today";
          if (s === selDate) cls += " selected";
          if (holiday) cls += " has-holiday";
          return (
            <div key={s} className={cls} onClick={() => onSelectDay(s)}>
              <div className="day-num">{day}</div>
              <div className="day-pips">
                {evts.slice(0,6).map((e,i) => <div key={i} className={`pip ${evClass(e)}`} />)}
                {holiday && <div className="pip holiday" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        {[["school","学校"],["together","两人"],["anniversary","纪念日"],["holiday","节假日"]].map(([cls,lbl]) => (
          <div key={cls} className="legend-item">
            <div className="legend-pip" style={{background:`var(--${cls})`}} />{lbl}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sidebar({ selDate, events, onDelete, onPhotoClick, curDate }) {
  const evts = selDate ? getEventsForDs(selDate, events) : [];
  const holiday = selDate ? getHolidayForDate(selDate) : null;
  const y = curDate.getFullYear(), m = curDate.getMonth()+1;
  const MONTHS = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
  const pre = `${y}-${String(m).padStart(2,'0')}`;
  const monthStart = `${pre}-01`, monthEnd = `${pre}-31`;
  const monthEvts = events.filter(e => {
    if (e.date.startsWith(pre)) return true;
    if (e.endDate && e.date <= monthEnd && e.endDate >= monthStart) return true;
    if (e.repeat) {
      const [,em] = e.date.split("-").map(Number);
      return em === m;
    }
    return false;
  });

  const stats = [
    { key:"together", label:"约会", icon:<Heart size={16} />, color:"var(--together)" },
    { key:"anniversary", label:"纪念日", icon:<Star size={15} />, color:"var(--anniversary)" },
    { key:"school", label:"假期", icon:<Flag size={15} />, color:"var(--school)" },
    { key:"him", label:"工作", icon:<Briefcase size={15} />, color:"var(--him)" },
  ];
  const schoolCount = monthEvts.filter(e => evClass(e) === "school").length;
  const holidayCount = MY_HOLIDAYS.filter(h => {
    if (!h.date.startsWith(pre)) return false;
    const dow = new Date(h.date + "T00:00:00").getDay();
    return dow >= 1 && dow <= 5;
  }).length;

  const today = todayDs();
  const upcoming = monthEvts
    .map(e => {
      if (!e.repeat) return e;
      const [,em,ed] = e.date.split("-").map(Number);
      const effectiveDate = `${y}-${String(em).padStart(2,'0')}-${String(ed).padStart(2,'0')}`;
      return { ...e, date: effectiveDate };
    })
    .filter(e => (e.endDate || e.date) >= today && e.type !== "holiday")
    .sort((a,b) => a.date.localeCompare(b.date))[0];

  return (
    <div className="sidebar">
      <div className="detail-card">
        <div className="detail-title">{selDate ? fmtDate(selDate) : "选择一个日期"}</div>
        <div className="detail-sub">{selDate ? (evts.length || holiday ? `${evts.length + (holiday?1:0)} 个活动` : "这天没有活动") : "点击日历查看当天活动"}</div>
        <div className="ev-list">
          {holiday && (
            <div className="holiday-notice">
              <Flag size={16} />
              <div className="holiday-notice-text">{holiday.name}</div>
            </div>
          )}
          {evts.length === 0 && !holiday && (
            <div className="empty-state">
              <div className="empty-icon"><CalendarIcon size={16} /></div>
              <p>{selDate ? "这天还没有活动" : "点击任意日期"}<br /><span style={{fontSize:11,opacity:.5}}>点击 + 添加</span></p>
            </div>
          )}
          {evts.map((e, i) => {
            const cls = evClass(e);
            const ownerLabel = null;
            const showBadge = ownerLabel && e.type !== "together" && e.type !== "anniversary";
            const photoSrc = safeImageSrc(e.photo);
            return (
              <div key={e.id} className={`ev-item ${cls}`} style={{animationDelay:`${i*.05}s`}}>
                <div className="ev-icon">{TYPE_ICONS[e.source === "school" ? "school" : e.type] || <CalendarIcon size={16} />}</div>
                <div className="ev-body">
                  <div className="ev-name">{e.title}</div>
                  <div className="ev-meta">
                    {e.endDate ? `${fmtDate(e.startDate || e.originalDate || e.date)} - ${fmtDate(e.endDate)}` : e.allDay ? "全天" : (e.time || "")}
                    {e.note ? ` · ${e.note}` : ""}
                  </div>
                </div>
                {photoSrc && <img className="ev-photo" src={photoSrc} alt="" onClick={() => onPhotoClick(photoSrc)} />}
                {showBadge && <span className="owner-badge">{ownerLabel}</span>}
                {!e.locked && <button className="ev-del" onClick={() => onDelete(e)}><X size={16} /></button>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ov-card">
        <div className="ov-header">
          <div className="ov-title">{MONTHS[m-1]}概览</div>
          <div className="ov-total-badge">{monthEvts.length + holidayCount} 个活动</div>
        </div>
        <div className="ov-grid">
          {stats.map(s => {
            const cnt = s.key === "school"
              ? schoolCount + holidayCount
              : monthEvts.filter(e => evClass(e) === s.key).length;
            return (
              <div key={s.key} className="ov-stat" style={{"--stat-color": s.color}}>
                <div className="ov-stat-icon">{s.icon}</div>
                <div className="ov-stat-count">{cnt}</div>
                <div className="ov-stat-label">{s.label}</div>
              </div>
            );
          })}
        </div>
        {upcoming && (
          <div className="ov-next">
            <div className="ov-next-label">本月下一个</div>
            <div className="ov-next-row">
              <div className={`ov-next-dot ${evClass(upcoming)}`} />
              <div className="ov-next-name">{upcoming.title}</div>
              <div className="ov-next-date">{fmtDate(upcoming.date)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddModal({ open, onClose, defaultDate, currentUser, onAdd }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("work");
  const [date, setDate] = useState(defaultDate || todayDs());
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const types = [
    { key:"work", label:"工作", icon:<Briefcase size={15} /> },
    { key:"assign", label:"Assignment", icon:<FileText size={15} /> },
    { key:"social", label:"社交", icon:<Users size={15} /> },
    { key:"together", label:"约会 / 两人", icon:<Heart size={16} /> },
    { key:"anniversary", label:"纪念日", icon:<Star size={15} /> },
  ];

  const handlePhoto = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setError("");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("只支持 JPG、PNG、WEBP 或 GIF 图片。");
      e.target.value = "";
      return;
    }
    if (file.size > LIMITS.imageBytes) {
      setError("图片不能超过 2MB。");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => { setPhoto(ev.target.result); setPhotoPreview(ev.target.result); };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    setTitle(""); setType("work"); setTime(""); setNote(""); setEndDate("");
    setAllDay(false); setRepeat(false); setPhoto(null); setPhotoPreview(null); setError("");
  };

  const handleSubmit = async () => {
    if (loading) return;
    const safeTitle = cleanText(title, LIMITS.title);
    const safeNote = cleanText(note, LIMITS.note);
    if (!safeTitle) { setError("请输入活动名称。"); return; }
    if (!isDateString(date)) { setError("请选择有效日期。"); return; }
    if (endDate && (!isDateString(endDate) || endDate <= date)) { setError("结束日期必须晚于开始日期。"); return; }
    if (!ALLOWED_TYPES.has(type)) { setError("活动类型无效。"); return; }
    if (time && !/^\d{2}:\d{2}$/.test(time)) { setError("时间格式无效。"); return; }
    setLoading(true);
    setError("");
    try {
      let photoUrl = null;
      if (photo) {
        const storageRef = ref(storage, `photos/${Date.now()}`);
        await uploadString(storageRef, photo, "data_url");
        photoUrl = await getDownloadURL(storageRef);
      }
      const shared = type === "together" || type === "anniversary";
      await onAdd({
        title: safeTitle, date, endDate: endDate || null, type,
        owner: shared ? null : "him",
        ownerEmail: currentUser?.email,
        note: safeNote, allDay,
        time: allDay ? null : time,
        repeat: repeat && type === "anniversary",
        photo: photoUrl,
      });
      reset(); onClose();
    } catch (err) {
      console.error(err);
      setError("保存失败，请稍后再试。");
    }
    setLoading(false);
  };

  if (!open) return null;
  return (
    <div className="overlay open" onClick={e => { if (e.target.classList.contains("overlay")) { reset(); onClose(); }}}>
      <div className="modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div className="modal-title">添加活动</div>
          <button className="modal-close" onClick={() => { reset(); onClose(); }}><X size={16} /></button>
        </div>
        <div className="f-group">
          <label className="f-label">活动名称</label>
          <input className="f-input" type="text" placeholder="例：期末考试、晚餐约会..."
            maxLength={LIMITS.title}
            value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()} autoFocus />
        </div>
        <div className="f-group">
          <label className="f-label">类型</label>
          <div className="type-pills">
            {types.map(t => (
              <button key={t.key}
                className={`type-pill${type === t.key ? ` active ${t.key}` : ""}`}
                onClick={() => { setType(t.key); if (t.key !== "anniversary") setRepeat(false); }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="f-row">
          <div className="f-group" style={{marginBottom:0}}>
            <label className="f-label">开始日期</label>
            <input className="f-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="f-group" style={{marginBottom:0}}>
            <label className="f-label">结束日期（选填）</label>
            <input className="f-input" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        {!endDate && (
          <div className="f-row" style={{marginTop:12}}>
            <div className="f-group" style={{marginBottom:0, opacity:allDay?.35:1, pointerEvents:allDay?"none":"all"}}>
              <label className="f-label">时间（选填）</label>
              <input className="f-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <div className="f-group" style={{marginBottom:0, display:"flex", alignItems:"flex-end"}}>
              <div className="toggle-row">
                <button className={`toggle${allDay?" on":""}`} onClick={() => setAllDay(!allDay)} />
                <span className="toggle-lbl">全天活动</span>
              </div>
            </div>
          </div>
        )}
        {type === "anniversary" && (
          <div className="f-group">
            <div className="toggle-row">
              <button className={`toggle${repeat?" on":""}`} onClick={() => setRepeat(!repeat)} />
              <span className="toggle-lbl">每年重复</span>
            </div>
          </div>
        )}
        <div className="f-group">
          <label className="f-label">备注（选填）</label>
          <input className="f-input" type="text" placeholder="地点、提醒..." maxLength={LIMITS.note} value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div className="f-group">
          <label className="f-label">照片（选填）</label>
          <div className="photo-upload-area" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto} />
            {photoPreview
              ? <img className="photo-preview-img" src={photoPreview} alt="" />
              : <div className="photo-placeholder"><ImageIcon size={22} /><span>点击上传照片</span></div>}
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-submit" onClick={handleSubmit} disabled={loading}>
          <Check size={16} /> {loading ? "添加中..." : "确认添加"}
        </button>
      </div>
    </div>
  );
}

function SchoolCalendarModal({ open, onClose, events, onAdd, onImport, onDelete }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayDs());
  const [endDate, setEndDate] = useState("");
  const [schoolType, setSchoolType] = useState("exam");
  const [owner, setOwner] = useState("her");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [semester, setSemester] = useState({
    midBreakStart: "",
    midBreakEnd: "",
    studyBreakStart: "",
    studyBreakEnd: "",
    examStart: "",
    examEnd: "",
    resultStart: "",
    resultEnd: "",
  });

  const schoolTypes = [
    { key: "exam", label: "考试" },
    { key: "break", label: "假期" },
    { key: "results", label: "成绩" },
  ];

  const submitOne = async () => {
    if (loading) return;
    const safeTitle = cleanText(title, LIMITS.title);
    if (!safeTitle) { setError("请输入学校事件标题。"); return; }
    if (!isDateString(date)) { setError("请选择有效开始日期。"); return; }
    if (endDate && (!isDateString(endDate) || endDate < date)) { setError("结束日期不能早于开始日期。"); return; }
    if (endDate && daysBetween(date, endDate) > LIMITS.schoolRangeDays) { setError("日期范围不能超过 180 天。"); return; }
    if (!ALLOWED_SCHOOL_TYPES.has(schoolType) || !ALLOWED_OWNERS.has(owner)) { setError("学校事件选项无效。"); return; }
    setLoading(true);
    setError("");
    try {
      await onAdd({
        title: safeTitle,
        date,
        endDate: endDate || null,
        type: "assign",
        schoolType,
        owner,
        source: "school",
        allDay: true,
      });
      setTitle("");
      setEndDate("");
    } catch (err) {
      console.error(err);
      setError("保存失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  const importSemester = async () => {
    if (loading) return;
    const batch = [];
    if (semester.midBreakStart) batch.push({ title: "Mid Semester Break", date: semester.midBreakStart, endDate: semester.midBreakEnd, schoolType: "break" });
    if (semester.studyBreakStart) batch.push({ title: "Study Break", date: semester.studyBreakStart, endDate: semester.studyBreakEnd, schoolType: "break" });
    if (semester.examStart) batch.push({ title: "Final Examination", date: semester.examStart, endDate: semester.examEnd, schoolType: "exam" });
    if (semester.resultStart) batch.push({ title: "Release of Results", date: semester.resultStart, endDate: semester.resultEnd, schoolType: "results" });
    if (!batch.length) return;
    const invalid = batch.some(item => (
      !isDateString(item.date)
      || (item.endDate && (!isDateString(item.endDate) || item.endDate < item.date || daysBetween(item.date, item.endDate) > LIMITS.schoolRangeDays))
      || !ALLOWED_SCHOOL_TYPES.has(item.schoolType)
    ));
    if (invalid) { setError("导入日期有误，请检查结束日期和范围。"); return; }
    setLoading(true);
    setError("");
    try {
      await onImport(batch.map(item => ({
        ...item,
        endDate: item.endDate || null,
        type: "assign",
        owner,
        source: "school",
        allDay: true,
      })));
      setSemester({
        midBreakStart: "",
        midBreakEnd: "",
        studyBreakStart: "",
        studyBreakEnd: "",
        examStart: "",
        examEnd: "",
        resultStart: "",
        resultEnd: "",
      });
    } catch (err) {
      console.error(err);
      setError("导入失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="overlay open" onClick={e => { if (e.target.classList.contains("overlay")) onClose(); }}>
      <div className="modal school-modal">
        <div className="modal-handle" />
        <div className="modal-hdr">
          <div>
            <div className="modal-title">学校日历</div>
            <div className="modal-sub">INTI / 学期关键日期</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="school-panel">
          <div className="school-panel-title">添加学校事件</div>
          <div className="f-group">
            <label className="f-label">标题</label>
            <input className="f-input" maxLength={LIMITS.title} value={title} onChange={e => setTitle(e.target.value)} placeholder="例：Quiz 1 / Midterm" />
          </div>
          <div className="f-row">
            <div className="f-group">
              <label className="f-label">开始日期</label>
              <input className="f-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="f-group">
              <label className="f-label">结束日期</label>
              <input className="f-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="f-row">
            <div className="f-group">
              <label className="f-label">类型</label>
              <select className="f-input" value={schoolType} onChange={e => setSchoolType(e.target.value)}>
                {schoolTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">谁的</label>
              <select className="f-input" value={owner} onChange={e => setOwner(e.target.value)}>
                <option value="her">her</option>
                <option value="him">him</option>
              </select>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn-submit school-submit" onClick={submitOne} disabled={loading}><Plus size={18} /> 添加学校事件</button>
        </div>

        <div className="school-panel">
          <div className="school-panel-title">导入学期</div>
          <div className="semester-grid">
            {[
              ["midBreakStart", "Mid Break 开始"],
              ["midBreakEnd", "Mid Break 结束"],
              ["studyBreakStart", "Study Break 开始"],
              ["studyBreakEnd", "Study Break 结束"],
              ["examStart", "考试开始"],
              ["examEnd", "考试结束"],
              ["resultStart", "成绩发布开始"],
              ["resultEnd", "成绩发布结束"],
            ].map(([key, label]) => (
              <div className="f-group" key={key}>
                <label className="f-label">{label}</label>
                <input className="f-input" type="date" value={semester[key]} onChange={e => setSemester({ ...semester, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <button className="btn-submit school-submit" onClick={importSemester} disabled={loading}><Check size={16} /> 导入学期</button>
        </div>

        <div className="school-panel">
          <div className="school-panel-title">已添加</div>
          <div className="school-list">
            {events.length === 0 && <div className="empty-state">还没有自定义学校事件</div>}
            {events.map(e => (
              <div className="school-row" key={e.id}>
                <div>
                  <div className="school-row-title">{e.title}</div>
                  <div className="ev-meta">{e.date}{e.endDate ? ` - ${e.endDate}` : ""}</div>
                </div>
                <button className="ev-del" onClick={() => onDelete(e)}><X size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const savedTimerDate = storageGet("togetherDate");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [noPermission, setNoPermission] = useState(false);
  const [theme, setTheme] = useState(storageGet("theme", "light") || "light");
  const [curDate, setCurDate] = useState(new Date());
  const [selDate, setSelDate] = useState(todayDs());
  const [events, setEvents] = useState([]);
  const [schoolEvents, setSchoolEvents] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [timerDate, setTimerDate] = useState(isDateString(savedTimerDate) ? savedTimerDate : "2025-01-01");
  const [timerEditOpen, setTimerEditOpen] = useState(false);
  const [timerEditVal, setTimerEditVal] = useState(timerDate);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    storageSet("theme", theme);
  }, [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (u && !ALLOWED_EMAILS.has(u.email)) {
        setNoPermission(true);
        setUser(null);
        setAuthLoading(false);
        return;
      }
      setNoPermission(false);
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "events"), orderBy("date"));
    const unsub = onSnapshot(q, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "school_events"), orderBy("date"));
    const unsub = onSnapshot(q, snap => {
      setSchoolEvents(snap.docs.map(d => ({ id: d.id, ...d.data(), source: "school" })));
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    DEFAULT_SCHOOL_EVENTS.forEach(item => {
      setDoc(doc(db, "school_events", item.id), item, { merge: true }).catch(console.error);
    });
    DEFAULT_ANNUAL_EVENTS.forEach(item => {
      setDoc(doc(db, "events", item.id), item, { merge: true }).catch(console.error);
    });
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    await signOut(auth); setEvents([]); setSchoolEvents([]);
  };

  const handleAdd = async (data) => {
    const safeData = normalizeEventInput(data, user);
    if (!safeData) return;
    await addDoc(collection(db, "events"), { ...safeData, createdAt: Date.now() });
  };

  const handleDelete = async (id) => {
    try { await deleteDoc(doc(db, "events", id)); } catch (e) { console.error(e); }
  };

  const handleAddSchool = async (data) => {
    const safeData = normalizeSchoolInput(data);
    if (!safeData) return;
    await addDoc(collection(db, "school_events"), { ...safeData, createdAt: Date.now() });
  };

  const handleImportSchool = async (items) => {
    for (const item of items) {
      const safeItem = normalizeSchoolInput(item);
      if (safeItem) await handleAddSchool(safeItem);
    }
  };

  const handleDeleteSchool = async (event) => {
    if (event.locked) return;
    try { await deleteDoc(doc(db, "school_events", event.id)); } catch (e) { console.error(e); }
  };

  const handleDeleteEvent = (event) => {
    if (event.source === "school") {
      handleDeleteSchool(event);
      return;
    }
    handleDelete(event.id);
  };

  const now = new Date();
  const dayNames = ["日","一","二","三","四","五","六"];
  const todayStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${dayNames[now.getDay()]}`;
  const schoolById = new Map([...DEFAULT_SCHOOL_EVENTS, ...schoolEvents].map(event => [event.id, event]));
  const allSchoolEvents = Array.from(schoolById.values());
  const allEvents = [...events, ...allSchoolEvents];

  if (authLoading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted)",fontSize:14}}>
      加载中...
    </div>
  );

  if (noPermission) return (
    <>
      <div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/>
      <NoPermissionScreen onLogout={handleLogout} />
    </>
  );

  if (!user) return (
    <>
      <div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/>
      <LoginScreen onLogin={handleLogin} />
    </>
  );

  return (
    <>
      <div className="blob blob-1"/><div className="blob blob-2"/><div className="blob blob-3"/>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <h1><em>Calendar</em></h1>
            <p>{todayStr}</p>
          </div>
          <div className="header-right">
            <button className="icon-btn" onClick={() => setTheme(t => t==="light"?"dark":"light")} title="切换主题">
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="icon-btn" onClick={() => setSchoolOpen(true)} title="学校日历"><CalendarIcon size={16} /></button>
            <button className="icon-btn" onClick={handleLogout} title="登出"><LogOut size={18} /></button>
            <button className="btn-add" onClick={() => setModalOpen(true)}><Plus size={18} /> 添加</button>
          </div>
        </header>

        <TimerBanner togetherDate={timerDate} onEdit={() => { setTimerEditVal(timerDate); setTimerEditOpen(true); }} />
        <Countdowns events={allEvents} />

        <div className="main-grid">
          <Calendar curDate={curDate} events={allEvents} selDate={selDate}
            onSelectDay={setSelDate}
            onChangeMonth={d => setCurDate(new Date(curDate.getFullYear(), curDate.getMonth()+d, 1))}
            onJumpTo={d => setCurDate(d)} />
          <Sidebar selDate={selDate} events={allEvents} curDate={curDate}
            onDelete={handleDeleteEvent} onPhotoClick={src => setLightboxSrc(src)} />
        </div>
      </div>

      <button className="fab" onClick={() => setModalOpen(true)}><Plus size={18} /></button>

      <AddModal key={`${modalOpen}-${selDate}`} open={modalOpen} onClose={() => setModalOpen(false)}
        defaultDate={selDate} currentUser={user} onAdd={handleAdd} />

      <SchoolCalendarModal open={schoolOpen} onClose={() => setSchoolOpen(false)}
        events={schoolEvents} onAdd={handleAddSchool} onImport={handleImportSchool} onDelete={handleDeleteSchool} />

      {timerEditOpen && (
        <div className="popup-overlay" onClick={e => { if (e.target.classList.contains("popup-overlay")) setTimerEditOpen(false); }}>
          <div className="popup-box">
            <div className="popup-title">编辑在一起日期</div>
            <div className="f-group">
              <label className="f-label">开始日期</label>
              <input className="f-input" type="date" value={timerEditVal} onChange={e => setTimerEditVal(e.target.value)} />
            </div>
            <div className="popup-btns">
              <button className="pbtn" onClick={() => setTimerEditOpen(false)}>取消</button>
              <button className="pbtn primary" onClick={() => {
                if (!isDateString(timerEditVal)) return;
                setTimerDate(timerEditVal);
                storageSet("togetherDate", timerEditVal);
                setTimerEditOpen(false);
              }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {safeImageSrc(lightboxSrc) && (
        <div className="lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={safeImageSrc(lightboxSrc)} alt="" />
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
