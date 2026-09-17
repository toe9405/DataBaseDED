/**
 * user.js — หน้ากำลังพล (User Page)
 * Defense Energy Department Personnel — ค้นหา/ดูข้อมูลได้ปกติ แต่ "เพิ่มข้อมูลใหม่" ได้เท่านั้น
 * (ไม่มีสิทธิ์ แก้ไข / ลบ / นำเข้า / ส่งออก / รีเซ็ตข้อมูล — สิทธิ์เหล่านี้สงวนไว้สำหรับ Admin เท่านั้น)
 */

// Key สำหรับบันทึกใน LocalStorage (สำรอง — ระบบหลักใช้ Google Sheet ผ่าน Apps Script ด้านล่าง)
const STORAGE_KEY = 'MILITARY_ENERGY_PERSONNEL_DATA_v3';

// ================= CLOUD API CONFIG (Google Apps Script Web App) =================
const API_URL = 'https://script.google.com/macros/s/AKfycbzYGMXReeo9OuGHN_Q8UAO29eQpsb3iDaVdRRzzvM_erq8dASWsCZQtD_hIyRmT4opnog/exec';
const API_SECRET = '2532';

/**
 * โหลดข้อมูลกำลังพลทั้งหมดจาก Google Sheet
 */
async function loadPersonnelFromCloud() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('โหลดข้อมูลจากระบบคลาวด์ไม่สำเร็จ');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * บันทึกกำลังพล 1 คน (เพิ่มใหม่) ลง Google Sheet
 */
async function savePersonnelToCloud(record) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'addPersonnel', secret: API_SECRET, record })
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || 'บันทึกข้อมูลไม่สำเร็จ');
  return result;
}

/**
 * อัปโหลดรูปภาพ (Base64) ขึ้น Google Drive ผ่าน Apps Script แล้วคืนลิงก์รูป
 */
async function uploadPhotoToCloud(base64Data, fileName, mimeType) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: 'uploadPhoto',
      secret: API_SECRET,
      base64: base64Data,
      fileName,
      mimeType
    })
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || 'อัปโหลดรูปภาพไม่สำเร็จ');
  return result.url;
}

/**
 * ดาวน์โหลดรูปประจำตัวเป็นไฟล์จริง (สำหรับปุ่มในหน้าดูประวัติกำลังพล)
 */
async function downloadMyAvatar(url, personName) {
  if (!url) {
    showToast('ไม่พบรูปภาพสำหรับดาวน์โหลด', 'error');
    return;
  }
  try {
    if (url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `avatar-${personName || 'photo'}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `avatar-${personName || 'photo'}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    // ติด CORS หรือโหลดไม่ได้ — เปิดรูปในแท็บใหม่ให้ผู้ใช้กดบันทึกเอง
    window.open(url, '_blank');
    showToast('ไม่สามารถดาวน์โหลดอัตโนมัติได้ เปิดรูปในแท็บใหม่แทน คลิกขวาแล้วเลือก "บันทึกรูปภาพเป็น..."', 'info');
  }
}

// Application State
let personnelList = [];

// สร้างเลขประจำตัว 4 หลักถัดไป (ไม่มีตัวอักษรนำหน้า) โดยหาเลขที่มากที่สุดในระบบแล้ว +1
function generateNextPersonnelId() {
  let maxNum = 0;
  personnelList.forEach(p => {
    const num = parseInt(String(p.id).replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  });
  return String(maxNum + 1).padStart(4, '0');
}
let currentFilter = {
  branch: 'all',
  department: 'all',
  division: 'all',
  rankCategory: 'all',
  searchQuery: '',
  sortBy: 'rank-asc'
};
let viewMode = 'grid'; // 'grid' | 'table'
let currentViewingId = null;

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
  await initData();
  initClock();
  initFormDivisions();
  renderDivisionPills();
  renderApp();
});

/**
 * โหลดข้อมูลกำลังพลจาก Google Sheet (คลาวด์)
 * ถ้าเชื่อมต่อไม่ได้ (ออฟไลน์/เน็ตหลุด) จะ fallback ไปใช้ข้อมูลที่แคชไว้ใน LocalStorage ล่าสุด
 */
async function initData() {
  try {
    personnelList = await loadPersonnelFromCloud();
    personnelList = personnelList.filter(p => !p.rank || !p.rank.includes('พลทหาร'));
    personnelList.forEach(p => {
      if (p.id !== undefined && p.id !== null) p.id = String(p.id);
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(personnelList)); // แคชไว้เผื่อออฟไลน์
  } catch (e) {
    console.error('โหลดจากคลาวด์ไม่สำเร็จ, ใช้ข้อมูลแคชล่าสุดแทน:', e);
    const cached = localStorage.getItem(STORAGE_KEY);
    personnelList = cached ? JSON.parse(cached) : [...INITIAL_PERSONNEL_DATA];
    personnelList.forEach(p => {
      if (p.id !== undefined && p.id !== null) p.id = String(p.id);
    });
    showToast('เชื่อมต่อฐานข้อมูลคลาวด์ไม่ได้ กำลังแสดงข้อมูลที่แคชไว้ล่าสุด', 'error');
  }
}

/**
 * บันทึกข้อมูลลง LocalStorage (ใช้เป็นแคชสำรองเท่านั้น — ข้อมูลจริงอยู่บน Google Sheet)
 */
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(personnelList));
}

/**
 * นาฬิกาและวันที่แบบไทย
 */
function initClock() {
  const clockEl = document.getElementById('current-time-display');
  if (!clockEl) return;

  const updateClock = () => {
    const now = new Date();
    const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const d = now.getDate();
    const m = thMonths[now.getMonth()];
    const y = now.getFullYear() + 543;
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockEl.textContent = `${d} ${m} ${y} • ${timeStr}`;
  };

  updateClock();
  setInterval(updateClock, 1000);
}

// ================= FILTER & SEARCH HANDLERS =================

function selectBranchFilter(branch) {
  currentFilter.branch = branch;

  ['all', 'army', 'navy', 'airforce', 'civil', 'employee'].forEach(b => {
    const tab = document.getElementById(`tab-${b}`);
    if (tab) {
      if (b === branch) tab.classList.add('active');
      else tab.classList.remove('active');
    }
  });

  renderApp();
}

function renderDivisionPills() {
  const container = document.getElementById('division-pills-container');
  if (!container) return;

  const active = currentFilter.division;

  let html = `
    <button
      onclick="selectDivisionFilter('all')"
      class="division-pill ${active === 'all' ? 'pill-active' : 'pill-inactive'}"
      title="แสดงทุกกอง / ทุกสำนัก"
    >
      <i class="fa-solid fa-border-all text-[11px]"></i>
      <span>ทุกกอง</span>
    </button>
  `;

  ENERGY_DEPT_STRUCTURE.forEach(item => {
    const isActive = active === item.division;
    html += `
      <button
        onclick="selectDivisionFilter('${escapeHtml(item.division)}')"
        class="division-pill ${isActive ? 'pill-active' : 'pill-inactive'}"
        style="${isActive ? `border-color:${item.color}60; background:${item.color}18; color:${item.color};` : ''}"
        title="${escapeHtml(item.division)}"
      >
        <i class="fa-solid ${item.icon} text-[11px]"></i>
        <span>${escapeHtml(item.shortName)}</span>
      </button>
    `;
  });

  container.innerHTML = html;
}

function selectDivisionFilter(divName) {
  currentFilter.division = divName;
  renderDivisionPills();
  renderApp();
}

/**
 * กำหนดตัวเลือกในฟอร์มเพิ่มข้อมูล (Division & Section)
 */
function initFormDivisions() {
  const divSelect = document.getElementById('form-division');
  if (!divSelect) return;

  divSelect.innerHTML = ENERGY_DEPT_STRUCTURE.map(item =>
    `<option value="${escapeHtml(item.division)}">${escapeHtml(item.division)}</option>`
  ).join('');

  if (ENERGY_DEPT_STRUCTURE.length > 0) {
    handleFormDivisionChange(ENERGY_DEPT_STRUCTURE[0].division);
  }
}

function handleFormDivisionChange(divName) {
  const secSelect = document.getElementById('form-section');
  if (!secSelect) return;

  const found = ENERGY_DEPT_STRUCTURE.find(item => item.division === divName);
  if (!found) return;

  if (found.sections.length === 1 && found.sections[0] === found.division) {
    secSelect.innerHTML = `<option value="">ประจำ${escapeHtml(found.division)}</option>`;
    secSelect.disabled = true;
  } else {
    secSelect.disabled = false;
    let html = `<option value="">ประจำ${escapeHtml(found.division)} (ไม่ระบุแผนก)</option>`;
    found.sections.forEach(sec => {
      html += `<option value="${escapeHtml(sec)}">${escapeHtml(sec)}</option>`;
    });
    secSelect.innerHTML = html;
  }

  handleFormSectionChange();
}

function handleFormSectionChange() {
  const divSelect = document.getElementById('form-division');
  const secSelect = document.getElementById('form-section');
  const deptHidden = document.getElementById('form-department');

  if (!divSelect || !deptHidden) return;

  const div = divSelect.value;
  const sec = secSelect && !secSelect.disabled ? secSelect.value : '';

  deptHidden.value = sec ? `${div} (${sec})` : div;

  updatePositionSuggestions(div, sec);
}

/**
 * อัปเดตตัวเลือกในช่อง "ตำแหน่ง" (dropdown) ตาม กอง/แผนก ที่เลือก
 * แสดงเฉพาะชื่อตำแหน่ง ไม่มียศกำกับต่อท้าย และมีตัวเลือก "อื่นๆ" สำหรับกรอกเอง
 */
function updatePositionSuggestions(div, sec) {
  const select = document.getElementById('form-position');
  if (!select) return;

  // เก็บค่าตำแหน่งที่ผู้ใช้เลือก/กรอกไว้ก่อนสร้างตัวเลือกใหม่ ป้องกันไม่ให้ค่าหายไปโดยไม่ตั้งใจ
  // (เช่น ตอนกดบันทึกฟอร์ม ซึ่งจะเรียกฟังก์ชันนี้ซ้ำผ่าน handleFormSectionChange)
  const previousValue = getFormPositionValue();

  const suggestions = getPositionSuggestions(div, sec);

  let html = '<option value="">-- เลือกตำแหน่ง --</option>';
  suggestions.forEach(title => {
    html += `<option value="${escapeHtml(title)}">${escapeHtml(title)}</option>`;
  });
  html += `<option value="__other__">อื่นๆ (ระบุเอง)</option>`;
  select.innerHTML = html;

  handleFormPositionChange();

  // คืนค่าตำแหน่งเดิมกลับเข้าไปในดรอปดาวน์ที่สร้างใหม่ (ถ้าตรงกับรายการใหม่ก็เลือกได้เลย
  // ถ้าไม่ตรงจะตกไปที่ "อื่นๆ" พร้อมเติมข้อความเดิมไว้ให้ ไม่ทำให้ค่าที่กรอกไว้หายไป)
  if (previousValue) {
    setFormPositionValue(previousValue);
  }
}

/**
 * ตั้งค่าตำแหน่งลงในดรอปดาวน์ตำแหน่ง (ใช้ทั้งตอนแก้ไขข้อมูลเดิม และตอนคืนค่าหลังสร้างตัวเลือกใหม่)
 * ถ้าตำแหน่งไม่ตรงกับรายการมาตรฐาน จะเลือก "อื่นๆ" และเติมค่าเดิมไว้ในช่องกรอกเอง
 */
function setFormPositionValue(positionText) {
  const select = document.getElementById('form-position');
  const customWrap = document.getElementById('form-position-custom-wrap');
  const customInput = document.getElementById('form-position-custom');
  if (!select) return;

  const trimmed = (positionText || '').trim();
  if (!trimmed) {
    select.value = '';
    if (customWrap) customWrap.classList.add('hidden');
    return;
  }

  const norm = normalizePositionText(trimmed);
  let matched = false;
  for (const opt of select.options) {
    if (opt.value && opt.value !== '__other__' && normalizePositionText(opt.value) === norm) {
      select.value = opt.value;
      matched = true;
      break;
    }
  }

  if (matched) {
    if (customWrap) customWrap.classList.add('hidden');
  } else {
    select.value = '__other__';
    if (customWrap) customWrap.classList.remove('hidden');
    if (customInput) customInput.value = trimmed;
  }
}

/**
 * สลับการแสดงช่องกรอกตำแหน่งเอง เมื่อผู้ใช้เลือก "อื่นๆ" ในดรอปดาวน์ตำแหน่ง
 */
function handleFormPositionChange() {
  const select = document.getElementById('form-position');
  const customWrap = document.getElementById('form-position-custom-wrap');
  if (!select || !customWrap) return;

  if (select.value === '__other__') {
    customWrap.classList.remove('hidden');
  } else {
    customWrap.classList.add('hidden');
    const customInput = document.getElementById('form-position-custom');
    if (customInput) customInput.value = '';
  }
}

/**
 * อ่านค่าตำแหน่งที่เลือกจริงจากฟอร์ม (รองรับกรณีเลือก "อื่นๆ" แล้วพิมพ์เอง)
 */
function getFormPositionValue() {
  const select = document.getElementById('form-position');
  if (!select) return '';
  if (select.value === '__other__') {
    const customInput = document.getElementById('form-position-custom');
    return customInput ? customInput.value.trim() : '';
  }
  return select.value.trim();
}

function handleSearch(query) {
  currentFilter.searchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) {
    if (query.length > 0) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  renderApp();
}

function clearSearch() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  handleSearch('');
}

function handleRankCategoryFilter(val) {
  currentFilter.rankCategory = val;
  renderApp();
}

function handleSortChange(val) {
  currentFilter.sortBy = val;
  renderApp();
}

function setViewMode(mode) {
  viewMode = mode;
  const gridBtn = document.getElementById('view-mode-grid');
  const tableBtn = document.getElementById('view-mode-table');
  const orgBtn = document.getElementById('view-mode-orgchart');

  const activeClass = 'px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-slate-800 shadow flex items-center gap-1.5 transition';
  const inactiveClass = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white flex items-center gap-1.5 transition';

  if (gridBtn) gridBtn.className = mode === 'grid' ? activeClass : inactiveClass;
  if (tableBtn) tableBtn.className = mode === 'table' ? activeClass : inactiveClass;
  if (orgBtn) orgBtn.className = mode === 'orgchart' ? activeClass : inactiveClass;

  // สำคัญ: ต้องเรียก renderApp() เพื่อให้ renderTable()/renderGrid() ทำงานจริง
  // ไม่งั้นแค่สลับการแสดง/ซ่อน div แต่เนื้อหาข้างในตาราง (tbody) จะยังว่างเปล่าอยู่
  renderApp();
}

function clearAllFilters() {
  currentFilter = {
    branch: 'all',
    department: 'all',
    division: 'all',
    rankCategory: 'all',
    searchQuery: '',
    sortBy: 'rank-asc'
  };

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.add('hidden');

  const rankCatSelect = document.getElementById('filter-rank-category');
  if (rankCatSelect) rankCatSelect.value = 'all';

  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) sortSelect.value = 'rank-asc';

  renderDivisionPills();
  selectBranchFilter('all');
}

// ================= DATA PROCESSING & SORTING =================

function getFilteredAndSortedPersonnel() {
  let list = [...personnelList];

  if (currentFilter.branch !== 'all') {
    list = list.filter(p => p.branch === currentFilter.branch);
  }

  if (currentFilter.division !== 'all') {
    list = list.filter(p => (p.department && p.department.includes(currentFilter.division)) || (p.secondedTo && p.secondedTo === currentFilter.division));
  }

  if (currentFilter.rankCategory !== 'all') {
    list = list.filter(p => {
      const tier = p.rankTier || 99;
      const isEmp = p.branch === 'employee' || (p.rank && (p.rank.includes('พนักงาน') || p.rank.includes('ลูกจ้าง')));

      if (currentFilter.rankCategory === 'general') return !isEmp && tier >= 1 && tier <= 4;
      if (currentFilter.rankCategory === 'field') return !isEmp && tier >= 5 && tier <= 11;
      if (currentFilter.rankCategory === 'nco') return !isEmp && tier >= 12 && tier <= 18;
      if (currentFilter.rankCategory === 'employee') return isEmp;
      return true;
    });
  }

  if (currentFilter.searchQuery) {
    const q = currentFilter.searchQuery;
    list = list.filter(p => {
      const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
      const rank = (p.rank || '').toLowerCase();
      const serviceId = (p.serviceId || '').toLowerCase();
      const dept = (p.department || '').toLowerCase();
      const pos = (p.position || '').toLowerCase();
      return fullName.includes(q) || rank.includes(q) || serviceId.includes(q) || dept.includes(q) || pos.includes(q);
    });
  }

  list.sort((a, b) => {
    switch (currentFilter.sortBy) {
      case 'rank-asc':
        if (a.rankTier !== b.rankTier) return a.rankTier - b.rankTier;
        if (a.joinedYear && b.joinedYear && a.joinedYear !== b.joinedYear) return a.joinedYear - b.joinedYear;
        return a.firstName.localeCompare(b.firstName, 'th');
      case 'rank-desc':
        if (a.rankTier !== b.rankTier) return b.rankTier - a.rankTier;
        return a.firstName.localeCompare(b.firstName, 'th');
      case 'name-asc':
        return a.firstName.localeCompare(b.firstName, 'th');
      case 'name-desc':
        return b.firstName.localeCompare(a.firstName, 'th');
      case 'seniority-asc':
        return (a.joinedYear || 9999) - (b.joinedYear || 9999);
      default:
        return a.rankTier - b.rankTier;
    }
  });

  return list;
}

// ================= RENDER FUNCTIONS =================

function renderApp() {
  renderKPIs();

  const emptyState = document.getElementById('empty-state');
  const gridContainer = document.getElementById('personnel-grid');
  const tableWrapper = document.getElementById('personnel-table-wrapper');
  const orgchartView = document.getElementById('orgchart-view');
  const filteredCountEl = document.getElementById('filtered-count');
  const totalCountEl = document.getElementById('total-count');

  // โหมดผังอัตรากำลัง: แสดงทุกกอง/แผนกพร้อมสถานะ "มีคนครอง/ว่าง" (ดูอย่างเดียว)
  if (viewMode === 'orgchart') {
    if (emptyState) emptyState.classList.add('hidden');
    if (gridContainer) gridContainer.classList.add('hidden');
    if (tableWrapper) tableWrapper.classList.add('hidden');
    if (orgchartView) orgchartView.classList.remove('hidden');
    if (filteredCountEl) filteredCountEl.textContent = personnelList.length;
    if (totalCountEl) totalCountEl.textContent = personnelList.length;
    renderOrgChart();
    return;
  }
  if (orgchartView) orgchartView.classList.add('hidden');

  const filteredList = getFilteredAndSortedPersonnel();

  if (filteredCountEl) filteredCountEl.textContent = filteredList.length;
  if (totalCountEl) totalCountEl.textContent = personnelList.length;

  if (filteredList.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (gridContainer) gridContainer.classList.add('hidden');
    if (tableWrapper) tableWrapper.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  if (viewMode === 'grid') {
    if (gridContainer) gridContainer.classList.remove('hidden');
    if (tableWrapper) tableWrapper.classList.add('hidden');
    renderGrid(filteredList);
  } else {
    if (gridContainer) gridContainer.classList.add('hidden');
    if (tableWrapper) tableWrapper.classList.remove('hidden');
    renderTable(filteredList);
  }
}

// ================= ROSTER / ORG CHART SYSTEM (VIEW ONLY) =================
const ROSTER_STORAGE_KEY = 'DED_PERSONNEL_ROSTER_LAYOUT_V3';
const UNSPECIFIED_SECTION = 'ส่วนกลางกอง (ไม่ระบุแผนก)';
let rosterLayout = {};
let rosterDivision = '';

function initRosterState() {
  try {
    rosterLayout = JSON.parse(localStorage.getItem(ROSTER_STORAGE_KEY) || '{}');
  } catch (e) {
    rosterLayout = {};
  }
  const allDivs = getAvailableRosterDivisions();
  if (!rosterDivision || !allDivs.includes(rosterDivision)) {
    rosterDivision = allDivs[0] || 'กองบัญชาการกรมการพลังงานทหาร';
  }
  ensureAllRosterLayouts(rosterDivision);
}

function getAvailableRosterDivisions() {
  const fromStructure = typeof ENERGY_DEPT_STRUCTURE !== 'undefined' ? ENERGY_DEPT_STRUCTURE.map(x => x.division) : [];
  const fromPeople = personnelList.map(rosterDivisionOf).filter(Boolean);
  const fromSeconded = personnelList.map(p => p.secondedTo).filter(Boolean);
  const combined = [...new Set([...fromStructure, ...fromPeople, ...fromSeconded])];
  return combined.filter(d => d && d !== 'ไม่ระบุกอง');
}

function rosterDivisionOf(p) {
  const department = String(p.department || 'ไม่ระบุกอง');
  const known = (typeof ENERGY_DEPT_STRUCTURE !== 'undefined' ? ENERGY_DEPT_STRUCTURE : []).find(x => department.includes(x.division));
  return known ? known.division : department.split(' (')[0];
}

function rosterSectionOf(p, div = rosterDivision) {
  if (p.secondedTo && p.secondedTo === div) {
    return p.secondedToSection ? p.secondedToSection.trim() : UNSPECIFIED_SECTION;
  }
  const matched = String(p.department || '').match(/\(([^)]+)\)/);
  return matched ? matched[1].trim() : UNSPECIFIED_SECTION;
}

function peopleInRosterDivision(div = rosterDivision) {
  return personnelList.filter(p => rosterDivisionOf(p) === div || p.secondedTo === div);
}

function rosterSecondmentNote(p, div = rosterDivision) {
  if (!p.secondedTo) return '';
  const home = rosterDivisionOf(p);
  const target = p.secondedToSection ? p.secondedTo + ' (' + p.secondedToSection + ')' : p.secondedTo;
  if (div === p.secondedTo && home !== p.secondedTo) return 'สังกัด ' + home + ' (ช่วยราชการ)';
  if (div === home) return 'ช่วยราชการ ' + target;
  return '';
}

function rosterSectionsOfDivision(div = rosterDivision) {
  const standard = typeof ENERGY_DEPT_STRUCTURE !== 'undefined' ? (ENERGY_DEPT_STRUCTURE.find(x => x.division === div)?.sections || []) : [];
  const allSections = [...new Set([...standard, ...peopleInRosterDivision(div).map(p => rosterSectionOf(p, div))])];
  return [
    UNSPECIFIED_SECTION,
    ...allSections.filter(s => s !== UNSPECIFIED_SECTION)
  ];
}

function rosterSectionLabel(section) {
  return section === UNSPECIFIED_SECTION ? 'ส่วนกลางกอง' : escapeHtml(section);
}

function rosterKey(section, div = rosterDivision) {
  return div + '::' + section;
}

function rosterLayoutOf(section, div = rosterDivision) {
  const k = rosterKey(section, div);
  let layout = rosterLayout[k];
  if (Array.isArray(layout)) {
    layout = { rows: layout, removed: [] };
    rosterLayout[k] = layout;
  }
  if (!layout) {
    layout = { rows: defaultRosterRows(rosterPeopleInSection(section, div)), removed: [] };
    rosterLayout[k] = layout;
  }
  if (!Array.isArray(layout.removed)) layout.removed = [];
  if (!Array.isArray(layout.rows)) layout.rows = [];
  return layout;
}

function rosterRows(section, div = rosterDivision) {
  return rosterLayoutOf(section, div).rows;
}

function rosterPeopleInSection(section, div = rosterDivision) {
  return peopleInRosterDivision(div).filter(p => rosterSectionOf(p, div) === section);
}

function generateRosterRowId() {
  return 'row-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
}

function defaultRosterRows(people) {
  const result = [
    { id: generateRosterRowId(), capacity: 1, people: [] },
    { id: generateRosterRowId(), capacity: 2, people: [] },
    { id: generateRosterRowId(), capacity: 3, people: [] }
  ];
  [...people]
    .sort((a, b) => (Number(a.rankTier) || 99) - (Number(b.rankTier) || 99))
    .forEach((p, i) => {
      const rowIdx = i === 0 ? 0 : i <= 2 ? 1 : 2;
      result[rowIdx].people.push(String(p.id));
    });
  result.forEach(r => {
    r.capacity = Math.max(r.capacity, r.people.length || 1);
  });
  return result;
}

function ensureSectionLayout(section, div = rosterDivision) {
  const pList = rosterPeopleInSection(section, div);
  const validIds = new Set(pList.map(p => String(p.id)));
  const layout = rosterLayoutOf(section, div);
  layout.removed = layout.removed.filter(id => validIds.has(String(id)));
  const removedSet = new Set(layout.removed.map(String));
  const targetRows = layout.rows;
  const used = new Set();

  targetRows.forEach(row => {
    row.people = (row.people || []).filter(id => validIds.has(String(id)) && !used.has(String(id)) && !removedSet.has(String(id)));
    row.people.forEach(id => used.add(String(id)));
    row.capacity = Math.max(Number(row.capacity) || 1, row.people.length);
  });

  const unplaced = [...validIds].filter(id => !used.has(id) && !removedSet.has(id));
  if (unplaced.length > 0) {
    if (!targetRows.length) {
      targetRows.push({ id: generateRosterRowId(), capacity: Math.max(3, unplaced.length), people: [] });
    }
    const lastRow = targetRows[targetRows.length - 1];
    lastRow.people.push(...unplaced);
    lastRow.capacity = Math.max(lastRow.capacity, lastRow.people.length);
  }
}

function ensureAllRosterLayouts(div = rosterDivision) {
  rosterSectionsOfDivision(div).forEach(sec => ensureSectionLayout(sec, div));
}

function handleRosterDivisionChange(newDiv) {
  rosterDivision = newDiv;
  ensureAllRosterLayouts(rosterDivision);
  renderOrgChart();
}

function getAssignedRosterPersonnel(div = rosterDivision) {
  const list = [];
  const secs = rosterSectionsOfDivision(div);
  let globalOrder = 1;
  secs.forEach(sec => {
    const layout = rosterLayoutOf(sec, div);
    layout.rows.forEach((row, rowIdx) => {
      row.people.forEach((pid, orderInRow) => {
        const p = personnelList.find(item => String(item.id) === String(pid));
        if (p) {
          list.push({
            globalOrder: globalOrder++,
            person: p,
            section: sec,
            rowId: row.id,
            rowIndex: rowIdx + 1,
            orderInRow: orderInRow + 1,
            note: rosterSecondmentNote(p, div)
          });
        }
      });
    });
  });
  return list;
}

function printRosterChart() {
  window.print();
}

/**
 * เรนเดอร์หน้า "ผังทำเนียบกำลังพล" (User Mode: ดูได้อย่างเดียว + ตารางรายชื่อในผัง)
 */
function renderOrgChart() {
  const container = document.getElementById('orgchart-content');
  if (!container) return;

  initRosterState();
  const divisions = getAvailableRosterDivisions();
  const divPeople = peopleInRosterDivision(rosterDivision);
  const assignedList = getAssignedRosterPersonnel(rosterDivision);
  const secs = rosterSectionsOfDivision(rosterDivision);

  const divSelectOptions = divisions.map(d => `<option value="${escapeHtml(d)}" ${d === rosterDivision ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');

  // 1. Directory Preview Sections
  const previewSectionsHtml = secs.map(sec => {
    const targetRows = rosterRows(sec, rosterDivision);
    const hasAssignedPeople = targetRows.some(r => r.people.length > 0);
    if (!hasAssignedPeople) return '';

    const rowsPreviewHtml = targetRows.map(row => {
      if (!row.people.length) return '';
      const cardsHtml = row.people.map(pid => {
        const p = personnelList.find(item => String(item.id) === String(pid));
        if (!p) return '';
        const note = rosterSecondmentNote(p, rosterDivision);
        const photo = p.avatar
          ? `<img src="${escapeHtml(p.avatar)}" class="w-full h-full object-cover cursor-pointer" onclick="viewPersonnel('${escapeHtml(p.id)}')" onerror="this.src='https://ded.mod.go.th/DED/media/unit-activities/logo-ded.png?ext=.png'">`
          : `<div class="w-full h-full flex items-center justify-center text-slate-500 text-3xl bg-slate-900 cursor-pointer" onclick="viewPersonnel('${escapeHtml(p.id)}')"><i class="fa-solid fa-user"></i></div>`;

        return `
          <div class="roster-card text-center flex flex-col items-center max-w-[190px] mx-auto">
            <div class="roster-photo-frame w-28 h-36 sm:w-36 sm:h-44 rounded-xl overflow-hidden bg-slate-800 relative mb-2">
              ${photo}
            </div>
            <div class="w-full px-1">
              <span class="text-xs sm:text-sm font-bold text-white block leading-tight truncate hover:text-amber-400 cursor-pointer" onclick="viewPersonnel('${escapeHtml(p.id)}')" title="${escapeHtml(p.rank || '')} ${escapeHtml(p.firstName || '')} ${escapeHtml(p.lastName || '')}">
                ${escapeHtml(p.rank || '')} ${escapeHtml(p.firstName || '')} ${escapeHtml(p.lastName || '')}
              </span>
              <span class="text-[10px] sm:text-[11px] text-amber-300/90 block truncate mt-0.5" title="${escapeHtml(p.position || '')}">
                ${escapeHtml(p.position || '-')}
              </span>
              ${note ? `<span class="text-[9px] text-sky-300 bg-sky-950/60 border border-sky-800/60 rounded px-1.5 py-0.5 inline-block truncate mt-1 max-w-full"><i class="fa-solid fa-right-left mr-0.5"></i>${escapeHtml(note)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="grid gap-4 sm:gap-6 justify-center items-start mb-8" style="grid-template-columns: repeat(${Math.max(1, row.people.length)}, minmax(0, 190px))">
          ${cardsHtml}
        </div>
      `;
    }).join('');

    return `
      <div class="border-t border-slate-800/80 pt-6 first:border-t-0 first:pt-0">
        <h4 class="text-center text-sm sm:text-base font-bold text-indigo-300 uppercase tracking-wider mb-6 flex items-center justify-center gap-3">
          <span class="w-12 h-px bg-indigo-500/30"></span>
          ${rosterSectionLabel(sec)}
          <span class="w-12 h-px bg-indigo-500/30"></span>
        </h4>
        ${rowsPreviewHtml}
      </div>
    `;
  }).join('');

  // 2. Bottom Table Rows
  const bottomTableRowsHtml = assignedList.map(item => {
    const p = item.person;
    const photo = p.avatar
      ? `<img src="${escapeHtml(p.avatar)}" class="w-9 h-11 object-cover rounded bg-slate-800 border border-slate-700" onerror="this.src='https://ded.mod.go.th/DED/media/unit-activities/logo-ded.png?ext=.png'">`
      : `<div class="w-9 h-11 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-xs"><i class="fa-solid fa-user"></i></div>`;

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3 text-center text-xs font-semibold text-slate-400">${item.globalOrder}</td>
        <td class="py-3 px-3">
          <span class="text-xs font-medium text-indigo-300 bg-indigo-950/40 border border-indigo-800/50 rounded-md px-2 py-0.5 whitespace-nowrap">
            ${rosterSectionLabel(item.section)}
          </span>
        </td>
        <td class="py-2 px-3">${photo}</td>
        <td class="py-3 px-3">
          <div class="font-semibold text-sm text-white hover:text-amber-400 cursor-pointer" onclick="viewPersonnel('${escapeHtml(p.id)}')">
            ${escapeHtml(p.rank || '')} ${escapeHtml(p.firstName || '')} ${escapeHtml(p.lastName || '')}
          </div>
          <div class="text-[11px] text-slate-500">${escapeHtml(p.serviceId || '')}</div>
        </td>
        <td class="py-3 px-3">
          <div class="text-xs text-slate-300 font-medium">${escapeHtml(p.position || '-')}</div>
          ${item.note ? `<div class="text-[10px] text-amber-400 mt-0.5"><i class="fa-solid fa-right-left mr-0.5"></i>${escapeHtml(item.note)}</div>` : ''}
        </td>
        <td class="py-3 px-3 text-center">
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-slate-700 font-mono font-bold">
            แถว ${item.rowIndex}
          </span>
        </td>
        <td class="py-3 px-3 text-center font-mono text-xs text-slate-300">
          ลำดับที่ ${item.orderInRow}
        </td>
        <td class="py-3 px-3 text-center">
          <button onclick="viewPersonnel('${escapeHtml(p.id)}')" class="text-xs py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 transition flex items-center gap-1 mx-auto">
            <i class="fa-solid fa-id-card"></i> ดูประวัติ
          </button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <!-- Top Control Bar -->
    <div class="glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-wider flex items-center gap-1">
              <i class="fa-solid fa-sitemap text-[10px]"></i> ผังทำเนียบกำลังพล
            </span>
            <span class="text-xs text-slate-400">กรมการพลังงานทหาร</span>
          </div>
          <h2 class="text-xl font-bold text-white mt-1 flex items-center gap-2">
            ${escapeHtml(rosterDivision)}
            <span class="text-xs font-normal text-slate-400">(${divPeople.length} นายในสังกัด • ในผัง ${assignedList.length} นาย)</span>
          </h2>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5">
            <label class="text-xs text-slate-400 whitespace-nowrap">เลือกกอง:</label>
            <select id="roster-division-select" onchange="handleRosterDivisionChange(this.value)" class="py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white font-medium focus:outline-none focus:border-amber-500">
              ${divSelectOptions}
            </select>
          </div>

          <button onclick="printRosterChart()" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5">
            <i class="fa-solid fa-print"></i>
            <span>พิมพ์ผัง</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Official Executive Org Chart Display -->
    <div class="glass-panel rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6 roster-print-container">
      <!-- Official Header -->
      <div class="text-center mb-10">
        <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-amber-800 p-0.5 shadow-xl shadow-amber-500/30 flex items-center justify-center">
          <div class="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center">
            <i class="fa-solid fa-bolt text-2xl text-amber-400"></i>
          </div>
        </div>
        <div class="text-xs font-semibold text-amber-400 tracking-widest uppercase">กรมการพลังงานทหาร</div>
        <h2 class="text-xl sm:text-2xl font-extrabold text-white mt-1 tracking-tight">ทำเนียบกำลังพล</h2>
        <p class="text-sm font-semibold text-slate-300 mt-1">${escapeHtml(rosterDivision)}</p>
      </div>

      <div class="space-y-8">
        ${previewSectionsHtml || '<p class="text-center py-16 text-slate-500 text-sm">ยังไม่มีกำลังพลที่ถูกจัดวางในผังของกองนี้</p>'}
      </div>
    </div>

    <!-- Bottom Section: Complete Personnel Table in Roster -->
    <div class="glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div>
          <h3 class="font-bold text-white text-base flex items-center gap-2">
            <i class="fa-solid fa-list-check text-emerald-400"></i> รายชื่อกำลังพลที่อยู่ในผังทำเนียบทั้งหมด
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">แสดงรายชื่อกำลังพลทั้งหมดที่จัดวางอยู่ในผัง ${escapeHtml(rosterDivision)} (เรียงตามลำดับแถวในผัง)</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs px-3 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
            อยู่ในผังทั้งหมด: ${assignedList.length} นาย
          </span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm text-slate-300">
          <thead class="bg-slate-900/90 text-xs uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th class="py-3 px-3 text-center">ลำดับ</th>
              <th class="py-3 px-3">แผนก / หน่วย</th>
              <th class="py-3 px-3">รูปภาพ</th>
              <th class="py-3 px-3">ยศ - ชื่อ - นามสกุล</th>
              <th class="py-3 px-3">ตำแหน่งหน้าที่</th>
              <th class="py-3 px-3 text-center">แถวในผัง</th>
              <th class="py-3 px-3 text-center">ลำดับในแถว</th>
              <th class="py-3 px-3 text-center">ดูข้อมูล</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            ${bottomTableRowsHtml || '<tr><td colspan="8" class="text-center py-8 text-slate-500 text-sm">ยังไม่มีกำลังพลที่ถูกจัดวางในผังทำเนียบของกองนี้</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderKPIs() {
  const total = personnelList.length;
  const armyCount = personnelList.filter(p => p.branch === 'army').length;
  const navyCount = personnelList.filter(p => p.branch === 'navy').length;
  const airCount = personnelList.filter(p => p.branch === 'airforce').length;
  const civilCount = personnelList.filter(p => p.branch === 'civil').length;
  const empCount = personnelList.filter(p => p.branch === 'employee').length;
  const generalCount = personnelList.filter(p => (p.rankTier || 99) <= 4 && p.branch !== 'employee' && p.branch !== 'civil').length;

  setText('stat-total', total);
  setText('stat-army', armyCount);
  setText('stat-navy', navyCount);
  setText('stat-airforce', airCount);
  setText('stat-civil', civilCount);
  setText('stat-employee', empCount);
  setText('stat-generals', generalCount);

  setText('badge-count-all', total);
  setText('badge-count-army', armyCount);
  setText('badge-count-navy', navyCount);
  setText('badge-count-airforce', airCount);
  setText('badge-count-civil', civilCount);
  setText('badge-count-employee', empCount);
}

/**
 * เรนเดอร์การ์ดกำลังพล (Grid View) — โหมดดูอย่างเดียว (ไม่มีปุ่มแก้ไข/ลบ)
 */
function renderGrid(list) {
  const grid = document.getElementById('personnel-grid');
  if (!grid) return;

  grid.innerHTML = list.map(p => {
    const branch = BRANCH_INFO[p.branch] || BRANCH_INFO.army;
    const tierBadge = getRankTierBadge(p.rankTier, p.branch, p.rank);
    const statusInfo = getStatusInfo(p.status);

    return `
      <div class="branch-card card-${p.branch} rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group">

        <div class="flex items-center justify-between gap-2 mb-3">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${branch.badgeClass}">
            <i class="fa-solid ${branch.icon} text-[11px]"></i>
            <span>${branch.nameTh}</span>
          </span>

          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${tierBadge.className}" title="ลำดับความอาวุโส Tier ${p.rankTier}">
            ${tierBadge.icon}
            <span>${tierBadge.label}</span>
          </span>
        </div>

        <div class="flex items-start gap-3.5">
          <div class="avatar-frame avatar-frame-${p.branch} flex-shrink-0 w-16 h-16 relative shadow-md">
            <img src="${resolveAvatarUrl(p)}" alt="${p.rank} ${p.firstName}" class="w-full h-full object-cover" onerror="this.src='${getDefaultAvatarForBranch(p.branch)}'">
            <span class="absolute bottom-0 right-0 status-indicator ${statusInfo.className} ring-2 ring-slate-900" title="${statusInfo.label}"></span>
          </div>

          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold text-amber-400 tracking-wide">${escapeHtml(p.rank)}</div>
            <h3 class="text-base font-bold text-white truncate group-hover:text-amber-300 transition">
              ${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}
            </h3>
            <p class="text-xs text-slate-400 truncate mt-0.5 flex items-center gap-1.5" title="${escapeHtml(p.position)}">
              <i class="fa-solid fa-briefcase text-[10px] text-slate-500 flex-shrink-0"></i>
              <span class="truncate">${escapeHtml(p.position) || 'ยังไม่ระบุตำแหน่ง'}</span>
            </p>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-300">
          <div class="flex items-center gap-2 text-slate-400">
            <i class="fa-solid fa-sitemap text-[11px] text-amber-500/80 w-4 flex-shrink-0"></i>
            <span class="truncate font-medium text-slate-200" title="${escapeHtml(p.department)}">${escapeHtml(p.department)}</span>
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span class="font-mono text-slate-400 flex items-center gap-1.5">
              <i class="fa-solid fa-id-badge text-slate-500 w-4"></i>
              ${escapeHtml(p.serviceId)}
            </span>
            <span>ปีบรรจุ: ${p.joinedYear || '-'}</span>
          </div>
        </div>

        <!-- Action: View only (no edit/delete for User page) -->
        <div class="mt-4 pt-3 border-t border-slate-800/80">
          <button onclick="viewPersonnel('${p.id}')" class="w-full py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5">
            <i class="fa-solid fa-id-card text-amber-400"></i>
            <span>ดูประวัติ</span>
          </button>
        </div>

      </div>
    `;
  }).join('');
}

/**
 * เรนเดอร์ข้อมูลในรูปแบบตาราง (Table View) — โหมดดูอย่างเดียว
 */
function renderTable(list) {
  const tbody = document.getElementById('personnel-table-body');
  if (!tbody) return;

  tbody.innerHTML = list.map(p => {
    const branch = BRANCH_INFO[p.branch] || BRANCH_INFO.army;
    const tierBadge = getRankTierBadge(p.rankTier, p.branch, p.rank);
    const statusInfo = getStatusInfo(p.status);

    return `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="py-3 px-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border border-slate-700">
              <img src="${resolveAvatarUrl(p)}" alt="${p.firstName}" class="w-full h-full object-cover" onerror="this.src='${getDefaultAvatarForBranch(p.branch)}'">
            </div>
            <div>
              <div class="font-bold text-white">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</div>
              <div class="text-xs font-mono text-slate-400">${escapeHtml(p.serviceId)}</div>
            </div>
          </div>
        </td>

        <td class="py-3 px-3">
          <div class="font-semibold text-amber-400 text-xs">${escapeHtml(p.rank)}</div>
          <span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${tierBadge.className} mt-1">
            ${tierBadge.label}
          </span>
        </td>

        <td class="py-3 px-3">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${branch.badgeClass}">
            <i class="fa-solid ${branch.icon} text-[10px]"></i>
            ${branch.nameTh}
          </span>
        </td>

        <td class="py-3 px-4 text-xs text-slate-300">
          <div class="max-w-[240px] truncate font-medium text-slate-200" title="${escapeHtml(p.department)}">${escapeHtml(p.department)}</div>
        </td>

        <td class="py-3 px-4 text-xs text-slate-300">
          <div class="max-w-[180px] truncate" title="${escapeHtml(p.position)}">${escapeHtml(p.position)}</div>
        </td>

        <td class="py-3 px-3 text-xs">
          <span class="inline-flex items-center gap-1.5">
            <span class="status-indicator ${statusInfo.className}"></span>
            <span class="text-slate-300">${statusInfo.label}</span>
          </span>
        </td>

        <td class="py-3 px-4 text-center">
          <button onclick="viewPersonnel('${p.id}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition" title="ดูประวัติ">
            <i class="fa-solid fa-id-card text-xs"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ================= ADD-ONLY MODAL HANDLERS =================

/**
 * เปิด Modal เพิ่มกำลังพลใหม่ (User ทำได้แค่เพิ่มเท่านั้น ไม่มีโหมดแก้ไข)
 */
function openAddModal() {
  document.getElementById('personnel-form').reset();

  const defaultBranch = 'army';
  document.getElementById('form-branch').value = defaultBranch;
  document.getElementById('form-avatar-preview').src = DEFAULT_AVATARS.army_1;
  document.getElementById('form-avatar-url').value = '';

  updateFormRanks(defaultBranch);

  if (ENERGY_DEPT_STRUCTURE.length > 0) {
    document.getElementById('form-division').value = ENERGY_DEPT_STRUCTURE[0].division;
    handleFormDivisionChange(ENERGY_DEPT_STRUCTURE[0].division);
  }

  // เลขประจำตัวและปีที่เริ่มรับราชการ: ให้ผู้ใช้กรอกเองทั้งหมด ไม่เติมค่าอัตโนมัติ
  document.getElementById('form-service-id').value = '';
  document.getElementById('form-joined-year').value = '';

  const modal = document.getElementById('form-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeFormModal() {
  const modal = document.getElementById('form-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function handleFormBranchChange(branch) {
  let defaultAv = DEFAULT_AVATARS.army_1;

  if (branch === 'navy') { defaultAv = DEFAULT_AVATARS.navy_1; }
  else if (branch === 'airforce') { defaultAv = DEFAULT_AVATARS.air_1; }
  else if (branch === 'civil') { defaultAv = DEFAULT_AVATARS.civil_1; }
  else if (branch === 'employee') { defaultAv = DEFAULT_AVATARS.emp_1; }

  document.getElementById('form-avatar-preview').src = defaultAv;

  // เลขประจำตัวกรอกเองทั้งหมด (ตัวเลข 10 หลัก ไม่มีคำนำหน้าเหล่าทัพ) จึงไม่ต้องปรับค่าตามเหล่าทัพที่เลือก

  updateFormRanks(branch);
}

function updateFormRanks(branch, selectedRank = null) {
  const rankSelect = document.getElementById('form-rank');
  const ranks = getRanksByBranch(branch);

  if (rankSelect) {
    rankSelect.innerHTML = ranks.map(r => {
      const isSel = selectedRank ? (r.rank === selectedRank) : false;
      return `<option value="${escapeHtml(r.rank)}" data-tier="${r.tier}" ${isSel ? 'selected' : ''}>${r.rank} (${r.titleEn}) - Tier ${r.tier}</option>`;
    }).join('');

    const currentRank = rankSelect.value;
    handleFormRankChange(currentRank);
  }
}

function handleFormRankChange(rankName) {
  const branch = document.getElementById('form-branch').value;
  const tier = getRankTier(rankName, branch);

  document.getElementById('form-rank-tier').value = tier;
  const badgeEl = document.getElementById('form-tier-badge');
  const descEl = document.getElementById('form-tier-desc');

  if (badgeEl) badgeEl.textContent = tier;
  if (descEl) {
    if (branch === 'employee') {
      descEl.textContent = 'พนักงานกรมการพลังงานทหาร';
    } else if (branch === 'civil') {
      if (rankName.includes('บริหาร')) {
        descEl.textContent = 'ประเภทบริหาร (มาตรา ๖ (๑))';
      } else if (rankName.includes('อำนวยการ')) {
        descEl.textContent = 'ประเภทอำนวยการ (มาตรา ๖ (๒))';
      } else if (rankName.includes('วิชาการ')) {
        descEl.textContent = 'ประเภทวิชาการ (มาตรา ๖ (๓))';
      } else if (rankName.includes('คณาจารย์') || rankName.includes('ครู')) {
        descEl.textContent = 'ประเภทการสอนหรือวิจัย (มาตรา ๖ (๔))';
      } else {
        descEl.textContent = 'ประเภททั่วไป (มาตรา ๖ (๕))';
      }
    } else if (tier <= 4) {
      descEl.textContent = 'ชั้นนายพล (Stars)';
    } else if (tier <= 8) {
      descEl.textContent = 'สัญญาบัตรชั้นผู้บังคับบัญชา';
    } else if (tier <= 11) {
      descEl.textContent = 'สัญญาบัตรชั้นต้น';
    } else if (tier <= 18) {
      descEl.textContent = 'นายทหารประทวน';
    } else {
      descEl.textContent = 'พนักงานประจำการ';
    }
  }
}

/**
 * จัดการอัปโหลดไฟล์รูปภาพ — เก็บไฟล์ต้นฉบับไว้ตามความละเอียดเดิม (ไม่ย่อ/ไม่บีบคุณภาพ)
 * เพื่อให้กำลังพลดาวน์โหลดไฟล์คุณภาพเต็มได้ภายหลัง ส่วนการแสดงผลในหน้าเว็บจะใช้ thumbnail
 * ที่ Google สร้างให้อัตโนมัติตอนแสดงผล (ไม่กระทบไฟล์ต้นฉบับที่เก็บไว้)
 */
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const maxSizeMB = 15;
  if (file.size > maxSizeMB * 1024 * 1024) {
    showToast(`ไฟล์รูปภาพใหญ่เกินไป (สูงสุด ${maxSizeMB}MB) กรุณาเลือกไฟล์ที่เล็กกว่านี้`, 'error');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('form-avatar-preview').src = e.target.result;
    showToast('อัปโหลดรูปภาพเรียบร้อย (เก็บไฟล์ต้นฉบับ ไม่บีบอัด)', 'success');
  };
  reader.onerror = () => {
    showToast('อ่านไฟล์รูปภาพไม่สำเร็จ', 'error');
  };
  reader.readAsDataURL(file);
}

function handleImageUrlInput(url) {
  if (url && url.trim().length > 5) {
    const directUrl = convertToDirectImageUrl(url);
    document.getElementById('form-avatar-preview').src = directUrl;
    document.getElementById('form-avatar-url').value = directUrl;
  }
}

/**
 * ดาวน์โหลดรูปภาพจาก URL ใดๆ มาเก็บเป็นไฟล์ที่เครื่องผู้ใช้
 * ถ้าโหลดแบบ blob ไม่สำเร็จ (เช่นติด CORS) จะเปิดรูปในแท็บใหม่แทน
 */
async function downloadImageFromUrl(url, filename) {
  if (!url) {
    showToast('ไม่พบรูปภาพสำหรับดาวน์โหลด', 'error');
    return;
  }
  try {
    if (url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'avatar.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'avatar.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    window.open(url, '_blank');
    showToast('ไม่สามารถดาวน์โหลดอัตโนมัติได้ เปิดรูปในแท็บใหม่แทน คลิกขวาแล้วเลือก "บันทึกรูปภาพเป็น..."', 'info');
  }
}

/**
 * ดาวน์โหลดรูปที่แสดงอยู่ในบัตรประจำตัว (Dossier) ที่กำลังเปิดดูอยู่ — ดาวน์โหลดไฟล์ต้นฉบับความละเอียดเต็ม
 */
function downloadCurrentViewAvatar() {
  const p = personnelList.find(item => item.id === currentViewingId);
  if (!p) {
    showToast('ไม่พบข้อมูลกำลังพลที่กำลังดูอยู่', 'error');
    return;
  }
  const url = resolveAvatarDownloadUrl(p);
  downloadImageFromUrl(url, `avatar-${p.firstName}_${p.lastName}.jpg`);
}

/**
 * ดาวน์โหลดรูปที่แสดงอยู่ในช่อง preview ของฟอร์มเพิ่มข้อมูล (ไฟล์ที่เพิ่งเลือก/วางลิงก์ไว้)
 */
function downloadCurrentFormAvatar() {
  const preview = document.getElementById('form-avatar-preview');
  const rawUrl = document.getElementById('form-avatar-url') ? document.getElementById('form-avatar-url').value : '';
  const url = rawUrl ? resolveAvatarDownloadUrl({ avatar: rawUrl }) : (preview ? preview.src : '');
  const nameInput = (document.getElementById('form-first-name') || {}).value || 'avatar';
  downloadImageFromUrl(url, `avatar-${nameInput}.jpg`);
}

/**
 * บันทึกกำลังพลใหม่ (User ทำได้แค่ "เพิ่ม" เท่านั้น — ไม่มีโหมดแก้ไข)
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  handleFormSectionChange();

  const branch = document.getElementById('form-branch').value;
  const rank = document.getElementById('form-rank').value;
  const rankTier = parseInt(document.getElementById('form-rank-tier').value, 10) || getRankTier(rank, branch);
  const firstName = document.getElementById('form-first-name').value.trim();
  const lastName = document.getElementById('form-last-name').value.trim();
  const serviceId = document.getElementById('form-service-id').value.trim();
  const department = document.getElementById('form-department').value.trim();
  const position = getFormPositionValue();
  const status = document.getElementById('form-status').value;
  const joinedYear = parseInt(document.getElementById('form-joined-year').value, 10) || null;
  const phone = document.getElementById('form-phone').value.trim();
  const email = document.getElementById('form-email').value.trim();
  const notes = document.getElementById('form-notes').value.trim();
  let avatar = document.getElementById('form-avatar-preview').src;

  if (!firstName || !lastName || !rank || !department) {
    showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน', 'error');
    return;
  }

  if (!position) {
    showToast('กรุณาเลือกหรือระบุตำแหน่ง', 'error');
    return;
  }

  const newId = generateNextPersonnelId();

  // ถ้าเพิ่งอัปโหลดรูปใหม่ (ยังเป็น Base64 อยู่) ให้อัปโหลดขึ้น Google Drive ก่อน แล้วเอาลิงก์มาใช้แทน
  if (avatar && avatar.startsWith('data:')) {
    try {
      showToast('กำลังอัปโหลดรูปภาพขึ้นระบบคลาวด์...', 'info');
      const mimeType = avatar.substring(5, avatar.indexOf(';'));
      const ext = mimeType.split('/')[1] || 'jpg';
      avatar = await uploadPhotoToCloud(avatar, `${newId}.${ext}`, mimeType);
    } catch (err) {
      showToast(`อัปโหลดรูปภาพไม่สำเร็จ: ${err.message}`, 'error');
      return;
    }
  }

  const newPersonnel = {
    id: newId,
    branch,
    rank,
    rankTier,
    firstName,
    lastName,
    serviceId,
    department,
    position,
    status,
    joinedYear,
    phone,
    email,
    notes,
    avatar
  };

  try {
    await savePersonnelToCloud(newPersonnel);
  } catch (err) {
    showToast(`บันทึกข้อมูลไม่สำเร็จ: ${err.message}`, 'error');
    return;
  }

  personnelList.unshift(newPersonnel);
  saveData(); // อัปเดตแคช LocalStorage ด้วย
  closeFormModal();
  renderApp();

  showToast(`เพิ่มกำลังพล ${rank} ${firstName} เรียบร้อย`, 'success');
}

// ================= VIEW PROFILE CARD MODAL (read-only) =================

function viewPersonnel(id) {
  const p = personnelList.find(item => String(item.id) === String(id));
  if (!p) return;

  currentViewingId = id;
  const branch = BRANCH_INFO[p.branch] || BRANCH_INFO.army;
  const tierBadge = getRankTierBadge(p.rankTier, p.branch, p.rank);
  const statusInfo = getStatusInfo(p.status);

  const container = document.getElementById('view-card-content');
  if (container) {
    container.innerHTML = `
      <div class="military-id-card rounded-2xl p-6 relative shadow-2xl border border-slate-700">

        <i class="fa-solid ${branch.icon} watermark-emblem text-slate-400"></i>

        <div class="flex items-center justify-between border-b border-slate-700/80 pb-4">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-lg ${branch.badgeClass}">
              <i class="fa-solid ${branch.icon}"></i>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-slate-400 font-bold">กรมการพลังงานทหาร • ${branch.nameEn}</div>
              <div class="text-sm font-bold text-white">${branch.nameTh}</div>
            </div>
          </div>
          <div class="text-right">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold ${tierBadge.className}">
              ${tierBadge.icon} ${tierBadge.label}
            </span>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-center sm:items-start gap-5 my-5">
          <div class="flex flex-col items-center gap-2 flex-shrink-0">
            <div class="w-28 h-36 rounded-xl overflow-hidden border-2 border-amber-500/80 shadow-lg bg-slate-950">
              <img src="${resolveAvatarUrl(p)}" alt="${p.firstName}" class="w-full h-full object-cover" onerror="this.src='${getDefaultAvatarForBranch(p.branch)}'">
            </div>
            <button onclick="downloadMyAvatar('${resolveAvatarDownloadUrl(p)}', '${escapeHtml(p.firstName)}_${escapeHtml(p.lastName)}')" class="no-print w-full text-[11px] py-1.5 px-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-700 transition flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-download"></i> ดาวน์โหลดรูป
            </button>
          </div>

          <div class="flex-1 space-y-2 text-center sm:text-left w-full">
            <div>
              <div class="text-xs font-semibold text-amber-400">${escapeHtml(p.rank)}</div>
              <h2 class="text-xl font-bold text-white">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</h2>
              <div class="text-xs text-slate-300 font-medium">
              <span class="text-slate-500">ตำแหน่ง:</span> ${escapeHtml(p.position) || '-'}
            </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-800 text-slate-300">
              <div>
                <span class="text-slate-500 block text-[10px]">เลขประจำตัว:</span>
                <span class="font-mono font-semibold text-slate-200">${escapeHtml(p.serviceId)}</span>
              </div>
              <div>
                <span class="text-slate-500 block text-[10px]">สถานะ:</span>
                <span class="inline-flex items-center gap-1 font-medium">
                  <span class="status-indicator ${statusInfo.className}"></span> ${statusInfo.label}
                </span>
              </div>
              <div class="col-span-2">
                <span class="text-slate-500 block text-[10px]">กอง / สำนัก / แผนก ในกรมการพลังงานทหาร:</span>
                <span class="font-semibold text-amber-300">${escapeHtml(p.department)}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-slate-950/80 rounded-xl p-4 border border-slate-800 space-y-2 text-xs">
          <div class="grid grid-cols-2 gap-3 text-slate-300">
            <div>
              <span class="text-slate-500 text-[10px] block">เบอร์โทรศัพท์ติดต่อ</span>
              <span><i class="fa-solid fa-phone text-slate-500 mr-1"></i> ${escapeHtml(p.phone || '-')}</span>
            </div>
            <div>
              <span class="text-slate-500 text-[10px] block">อีเมลราชการ</span>
              <span class="truncate block"><i class="fa-solid fa-envelope text-slate-500 mr-1"></i> ${escapeHtml(p.email || '-')}</span>
            </div>
            <div>
              <span class="text-slate-500 text-[10px] block">ปีที่เริ่มรับราชการ/ทำงาน</span>
              <span>พ.ศ. ${p.joinedYear || '-'}</span>
            </div>
            <div>
              <span class="text-slate-500 text-[10px] block">รหัสระบบ</span>
              <span class="font-mono text-slate-400">${p.id}</span>
            </div>
          </div>

          ${p.notes ? `
            <div class="pt-2 border-t border-slate-800/80">
              <span class="text-slate-500 text-[10px] block">ประวัติการศึกษา / ประวัติราชการ:</span>
              <p class="text-slate-300 text-xs mt-0.5">${escapeHtml(p.notes)}</p>
            </div>
          ` : ''}
        </div>

        <div class="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
          <span>DED-ID-${p.serviceId}</span>
          <span class="tracking-widest">||| | ||||| || ||| |||| | |||</span>
          <span>DEFENSE ENERGY DEPT</span>
        </div>

      </div>
    `;
  }

  const modal = document.getElementById('view-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeViewModal() {
  const modal = document.getElementById('view-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function printCurrentCard() {
  window.print();
}

// ================= UTILITIES & HELPERS =================

function getRankTierBadge(tier, branch, rank = '') {
  if (branch === 'civil' || rank.startsWith('ขรก.พลเรือนกลาโหม')) {
    return { className: 'tier-civil', label: `ขรก.พลเรือน (Tier ${tier})`, icon: '<i class="fa-solid fa-user-tie text-purple-400"></i>' };
  }
  if (branch === 'employee' || rank.includes('พนักงาน') || rank.includes('ลูกจ้าง')) {
    return { className: 'tier-employee', label: `พนง.พลังงานทหาร (Tier ${tier})`, icon: '<i class="fa-solid fa-building-user text-amber-400"></i>' };
  }
  if (tier <= 4) {
    return { className: 'tier-general', label: `ชั้นนายพล (Tier ${tier})`, icon: '<i class="fa-solid fa-star text-amber-400"></i>' };
  } else if (tier <= 8) {
    return { className: 'tier-field', label: `สัญญาบัตร (Tier ${tier})`, icon: '<i class="fa-solid fa-shield text-slate-300"></i>' };
  } else if (tier <= 11) {
    return { className: 'tier-company', label: `สัญญาบัตรต้น (Tier ${tier})`, icon: '<i class="fa-solid fa-chevron-up text-amber-200"></i>' };
  } else if (tier <= 18) {
    return { className: 'tier-nco', label: `ประทวน (Tier ${tier})`, icon: '<i class="fa-solid fa-bars text-slate-400"></i>' };
  } else {
    return { className: 'tier-employee', label: `พนง.พลังงานทหาร (Tier ${tier})`, icon: '<i class="fa-solid fa-building-user text-amber-400"></i>' };
  }
}

function getStatusInfo(status) {
  switch (status) {
    case 'active': return { label: 'ปฏิบัติหน้าที่ปกติ', className: 'status-active' };
    case 'duty': return { label: 'ไปราชการ / ฝึกภาคสนาม', className: 'status-duty' };
    case 'leave': return { label: 'ลาพัก / ศึกษาต่อ', className: 'status-leave' };
    case 'retired': return { label: 'ปลดประจำการ / พ้นสภาพ', className: 'status-retired' };
    default: return { label: 'ปฏิบัติหน้าที่ปกติ', className: 'status-active' };
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  let icon = 'fa-circle-info text-blue-400';
  let borderColor = 'border-slate-700';
  if (type === 'success') { icon = 'fa-circle-check text-emerald-400'; borderColor = 'border-emerald-500/40'; }
  else if (type === 'error') { icon = 'fa-circle-exclamation text-red-400'; borderColor = 'border-red-500/40'; }

  toast.className = `p-3.5 rounded-xl bg-slate-900/95 text-slate-100 text-xs shadow-2xl border ${borderColor} flex items-center space-x-2.5 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  toast.innerHTML = `<i class="fa-solid ${icon} text-base"></i><span class="font-medium">${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, 3500);
}
