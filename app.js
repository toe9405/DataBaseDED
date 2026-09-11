/**
 * Military Personnel Management System - Core Application Logic
 * ระบบจัดการข้อมูลกำลังพล กรมการพลังงานทหาร - โค้ดควบคุมการทำงานหลัก
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
 * บันทึกกำลังพล 1 คน (เพิ่มใหม่ หรือแก้ไข) ลง Google Sheet
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
 * ลบกำลังพล 1 คน ออกจาก Google Sheet
 */
async function deletePersonnelFromCloud(id) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'deletePersonnel', secret: API_SECRET, id })
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || 'ลบข้อมูลไม่สำเร็จ');
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
  division: 'all',       // กอง filter (from division pills)
  rankCategory: 'all',
  searchQuery: '',
  sortBy: 'rank-asc'
};
let viewMode = 'grid'; // 'grid' | 'table'
let currentViewingId = null;
let currentDeletingId = null;

// ================= ADMIN PIN CONFIG =================
// เปลี่ยน PIN ได้ที่นี่
const ADMIN_PIN = '6789';
const PIN_SESSION_KEY = 'ADMIN_SESSION_UNLOCKED';

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
  checkPinSession();
});

/**
 * ตรวจสอบ Session PIN — ถ้าผ่านแล้วให้ข้ามหน้า PIN
 */
function checkPinSession() {
  const unlocked = sessionStorage.getItem(PIN_SESSION_KEY);
  if (unlocked === 'true') {
    unlockAdmin();
  } else {
    // Focus PIN input
    setTimeout(() => {
      const pinInput = document.getElementById('pin-input');
      if (pinInput) pinInput.focus();
    }, 100);
  }
}

/**
 * Auto-submit เมื่อกรอก PIN ครบ 4 หลัก
 */
function handlePinInput(val) {
  // กรองเฉพาะตัวเลข
  const numeric = val.replace(/\D/g, '');
  const pinInput = document.getElementById('pin-input');
  if (pinInput) pinInput.value = numeric;

  const errEl = document.getElementById('pin-error');
  if (errEl) errEl.classList.add('hidden');

  if (numeric.length === 4) {
    submitPin();
  }
}

/**
 * ตรวจสอบ PIN และเปิดหน้า Admin
 */
function submitPin() {
  const pinInput = document.getElementById('pin-input');
  const errEl = document.getElementById('pin-error');
  const enteredPin = pinInput ? pinInput.value.replace(/\D/g, '') : '';

  if (enteredPin === ADMIN_PIN) {
    sessionStorage.setItem(PIN_SESSION_KEY, 'true');
    unlockAdmin();
  } else {
    if (errEl) errEl.classList.remove('hidden');
    if (pinInput) {
      pinInput.value = '';
      pinInput.classList.add('border-red-500');
      setTimeout(() => {
        pinInput.classList.remove('border-red-500');
        pinInput.focus();
      }, 800);
    }
  }
}

/**
 * ปลดล็อก Admin — ซ่อน PIN gate และโหลดระบบ
 */
async function unlockAdmin() {
  const gate = document.getElementById('pin-gate');
  if (gate) {
    gate.style.opacity = '0';
    gate.style.transition = 'opacity 0.3s ease';
    setTimeout(() => gate.classList.add('hidden'), 300);
  }
  // Init app after unlock
  await initData();
  initClock();
  setupDepartmentOptions();
  initFormDivisions();
  renderDivisionPills();
  renderApp();
}

/**
 * ล็อก Admin และกลับหน้า PIN
 */
function lockAdmin() {
  sessionStorage.removeItem(PIN_SESSION_KEY);
  const gate = document.getElementById('pin-gate');
  if (gate) {
    gate.classList.remove('hidden');
    gate.style.opacity = '0';
    requestAnimationFrame(() => {
      gate.style.transition = 'opacity 0.3s ease';
      gate.style.opacity = '1';
    });
    setTimeout(() => {
      const pinInput = document.getElementById('pin-input');
      if (pinInput) { pinInput.value = ''; pinInput.focus(); }
    }, 350);
  }
}


/**
 * โหลดข้อมูลกำลังพลจาก Google Sheet (คลาวด์)
 * ถ้าเชื่อมต่อไม่ได้ (ออฟไลน์/เน็ตหลุด) จะ fallback ไปใช้ข้อมูลที่แคชไว้ใน LocalStorage ล่าสุด
 */
async function initData() {
  try {
    personnelList = await loadPersonnelFromCloud();
    personnelList = personnelList.filter(p => !p.rank || !p.rank.includes('พลทหาร'));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(personnelList)); // แคชไว้เผื่อออฟไลน์
  } catch (e) {
    console.error('โหลดจากคลาวด์ไม่สำเร็จ, ใช้ข้อมูลแคชล่าสุดแทน:', e);
    const cached = localStorage.getItem(STORAGE_KEY);
    personnelList = cached ? JSON.parse(cached) : [...INITIAL_PERSONNEL_DATA];
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

/**
 * เลือกกรองตามเหล่าทัพ/สังกัด (ทั้งหมด, ทบ., ทร., ทอ., ขรก.พลเรือน, พนักงานกรมการพลังงานทหาร)
 */
function selectBranchFilter(branch) {
  currentFilter.branch = branch;

  // อัปเดต Active Tab UI
  ['all', 'army', 'navy', 'airforce', 'civil', 'employee'].forEach(b => {
    const tab = document.getElementById(`tab-${b}`);
    if (tab) {
      if (b === branch) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    }
  });

  renderApp();
}

/**
 * สร้างปุ่มกรองระดับกอง (Division Pills) จาก ENERGY_DEPT_STRUCTURE
 */
function renderDivisionPills() {
  const container = document.getElementById('division-pills-container');
  if (!container) return;

  const active = currentFilter.division;

  // ปุ่ม "ทุกกอง"
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

  // ปุ่มแต่ละกอง
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

/**
 * เลือกกรองตามกอง (Division Pills)
 */
function selectDivisionFilter(divName) {
  currentFilter.division = divName;
  renderDivisionPills();
  renderApp();
}


function setupDepartmentOptions() {
  const deptSelect = document.getElementById('filter-department');
  if (!deptSelect) return;

  let html = '<option value="all">ทุกกอง / ทุกสำนัก / ทุกแผนก</option>';
  
  ENERGY_DEPT_STRUCTURE.forEach(item => {
    html += `<optgroup label="🏢 ${escapeHtml(item.division)}">`;
    html += `<option value="div:${escapeHtml(item.division)}">${escapeHtml(item.division)} (ทั้งหมด)</option>`;
    
    item.sections.forEach(sec => {
      if (sec !== item.division) {
        const fullVal = `${item.division} (${sec})`;
        html += `<option value="${escapeHtml(fullVal)}">↳ ${escapeHtml(sec)}</option>`;
      }
    });
    
    html += `</optgroup>`;
  });
  
  deptSelect.innerHTML = html;
}

function handleDepartmentFilter(val) {
  currentFilter.department = val;
  renderApp();
}

/**
 * กำหนดตัวเลือกในฟอร์ม เพิ่ม/แก้ไข (Division & Section)
 */
function initFormDivisions() {
  const divSelect = document.getElementById('form-division');
  if (!divSelect) return;

  divSelect.innerHTML = ENERGY_DEPT_STRUCTURE.map(item => {
    return `<option value="${escapeHtml(item.division)}">${escapeHtml(item.division)}</option>`;
  }).join('');

  populateSecondedToOptions();

  if (ENERGY_DEPT_STRUCTURE.length > 0) {
    handleFormDivisionChange(ENERGY_DEPT_STRUCTURE[0].division);
  }
}

/**
 * เติมตัวเลือก "กองที่ไปช่วยราชการ" — รายชื่อกอง/สำนักทั้งหมด บวกตัวเลือก "ไม่ได้ช่วยราชการ"
 */
/**
 * ข้อความแสดงกองปลายทางที่ไปช่วยราชการ พร้อมแผนก (ถ้ามีการระบุ)
 */
function formatSecondedTo(p) {
  if (!p || !p.secondedTo) return '';
  return p.secondedToSection ? `${p.secondedTo} (${p.secondedToSection})` : p.secondedTo;
}

function populateSecondedToOptions() {
  const sel = document.getElementById('form-seconded-to');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- ไม่ได้ช่วยราชการ --</option>' +
    ENERGY_DEPT_STRUCTURE.map(item => `<option value="${escapeHtml(item.division)}">${escapeHtml(item.division)}</option>`).join('');
  sel.value = current || '';
}

/**
 * เติมตัวเลือก "แผนก" ของกองปลายทางที่ไปช่วยราชการ ตามกองที่เลือกไว้ในช่อง form-seconded-to
 * เรียกใหม่ทุกครั้งที่เปลี่ยนกองปลายทาง (หรือตอนเปิดฟอร์มแก้ไขข้อมูลเดิม)
 */
function handleSecondedToChange(divName, selectedSection = '') {
  const secSel = document.getElementById('form-seconded-section');
  if (!secSel) return;

  const found = ENERGY_DEPT_STRUCTURE.find(item => item.division === divName);

  if (!divName || !found || found.sections.length === 0 || (found.sections.length === 1 && found.sections[0] === found.division)) {
    secSel.innerHTML = '<option value="">-- ไม่ระบุแผนก --</option>';
    secSel.value = '';
    secSel.disabled = true;
    return;
  }

  secSel.disabled = false;
  let html = '<option value="">-- ไม่ระบุแผนก --</option>';
  found.sections.forEach(sec => {
    const isSel = selectedSection === sec ? 'selected' : '';
    html += `<option value="${escapeHtml(sec)}" ${isSel}>${escapeHtml(sec)}</option>`;
  });
  secSel.innerHTML = html;
}

function handleFormDivisionChange(divName, selectedSection = null) {
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
      const isSel = selectedSection === sec ? 'selected' : '';
      html += `<option value="${escapeHtml(sec)}" ${isSel}>${escapeHtml(sec)}</option>`;
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

  if (sec) {
    deptHidden.value = `${div} (${sec})`;
  } else {
    deptHidden.value = div;
  }

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

/**
 * ตั้งค่าตำแหน่งปัจจุบันของกำลังพลลงในดรอปดาวน์ตำแหน่ง (ใช้ตอนเปิดฟอร์มแก้ไข)
 * ถ้าตำแหน่งเดิมไม่ตรงกับรายการมาตรฐาน จะเลือก "อื่นๆ" และเติมค่าเดิมไว้ในช่องกรอกเอง
 * โดยไม่มีการแก้ไขค่าตำแหน่งเดิมของกำลังพลแต่อย่างใด
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
 * ค้นหาแบบ Real-time
 */
function handleSearch(query) {
  currentFilter.searchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) {
    if (query.length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
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

  const deptSelect = document.getElementById('filter-department');
  if (deptSelect) deptSelect.value = 'all';

  const rankCatSelect = document.getElementById('filter-rank-category');
  if (rankCatSelect) rankCatSelect.value = 'all';

  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) sortSelect.value = 'rank-asc';

  renderDivisionPills();
  selectBranchFilter('all');
}

// ================= DATA PROCESSING & SORTING =================

/**
 * กรองและเรียงลำดับข้อมูลกำลังพลตามเงื่อนไขที่กำหนด
 */
function getFilteredAndSortedPersonnel() {
  let list = [...personnelList];

  // 1. กรองตามเหล่าทัพ/สังกัดเดิม (Branch)
  if (currentFilter.branch !== 'all') {
    list = list.filter(p => p.branch === currentFilter.branch);
  }

  // 2. กรองตามกอง (Division Pills)
  if (currentFilter.division !== 'all') {
    list = list.filter(p => p.department && p.department.includes(currentFilter.division));
  }

  // 3. กรองตามกอง/แผนก ใน Dropdown (department - legacy, hidden but kept)
  if (currentFilter.department !== 'all') {
    if (currentFilter.department.startsWith('div:')) {
      const divName = currentFilter.department.replace('div:', '');
      list = list.filter(p => p.department && p.department.includes(divName));
    } else {
      list = list.filter(p => p.department && (p.department === currentFilter.department || p.department.includes(currentFilter.department)));
    }
  }

  // 3. กรองตามหมวดหมู่ชั้นยศ (Rank Category)
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

  // 4. กรองตามคำค้นหา (Search Query)
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

  // 5. จัดเรียงลำดับ (Sorting)
  list.sort((a, b) => {
    switch (currentFilter.sortBy) {
      case 'rank-asc':
        // ยศสูงที่สุดไปต่ำสุด: Rank Tier 1 -> 2 -> 3 (ตัวเลขน้อยคือยศสูง)
        if (a.rankTier !== b.rankTier) {
          return a.rankTier - b.rankTier;
        }
        // หากยศเท่ากัน ให้เรียงตามปีรับราชการ (อาวุโสกว่ามาก่อน)
        if (a.joinedYear && b.joinedYear && a.joinedYear !== b.joinedYear) {
          return a.joinedYear - b.joinedYear;
        }
        return a.firstName.localeCompare(b.firstName, 'th');

      case 'rank-desc':
        // ยศต่ำสุดไปสูงที่สุด
        if (a.rankTier !== b.rankTier) {
          return b.rankTier - a.rankTier;
        }
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

/**
 * เรนเดอร์หน้าจอหลักทั้งหมด (KPIs, Tabs, List)
 */
function renderApp() {
  renderKPIs();

  const emptyState = document.getElementById('empty-state');
  const gridContainer = document.getElementById('personnel-grid');
  const tableWrapper = document.getElementById('personnel-table-wrapper');
  const orgchartView = document.getElementById('orgchart-view');
  const filteredCountEl = document.getElementById('filtered-count');
  const totalCountEl = document.getElementById('total-count');

  // โหมดผังอัตรากำลัง: แสดงทุกกอง/แผนกพร้อมสถานะ "มีคนครอง/ว่าง" ไม่ใช้ตัวกรองค้นหาปกติ
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

  // อัปเดต Status Bar ตัวเลขสรุป
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

/**
 * เรนเดอร์หน้า "ผังโครงสร้างอัตรากำลัง"
 * แสดงตำแหน่งมาตรฐานของทุกกอง/แผนก พร้อมระบุว่ามีผู้ครองตำแหน่งแล้วหรือว่าง
 */
function renderOrgChart() {
  const container = document.getElementById('orgchart-content');
  if (!container) return;

  let html = '';

  ENERGY_DEPT_STRUCTURE.forEach(divDef => {
    const rows = getDivisionPositionRoster(divDef.division);
    if (!rows || rows.length === 0) return;

    let filledCount = 0;
    let lastSection = undefined;
    const rowsHtml = [];

    rows.forEach(row => {
      const matched = findPersonnelForPosition(personnelList, divDef.division, row.section, row.title);
      if (matched.length > 0) filledCount++;

      if (row.section !== lastSection) {
        if (row.section) {
          rowsHtml.push(
            `<div class="pt-3 pb-1 px-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <i class="fa-solid fa-folder-tree text-[10px]"></i>${escapeHtml(row.section)}
            </div>`
          );
        }
        lastSection = row.section;
      }

      let peopleHtml;
      if (matched.length > 0) {
        peopleHtml = matched.map(p =>
          `<span class="px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300 border border-emerald-700/40 text-xs whitespace-nowrap">
            ${escapeHtml(p.rank || '')} ${escapeHtml(p.firstName || '')} ${escapeHtml(p.lastName || '')}
          </span>`
        ).join(' ');
      } else {
        peopleHtml = `<span class="px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-500 border border-slate-700/50 text-xs">ว่าง</span>`;
      }

      rowsHtml.push(
        `<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${matched.length > 0 ? 'bg-slate-900/40' : 'bg-slate-900/15'} border border-slate-800/60">
          <div class="text-sm text-slate-200">${escapeHtml(row.title)}</div>
          <div class="flex flex-wrap gap-1.5 justify-end">${peopleHtml}</div>
        </div>`
      );
    });

    html += `
      <div class="glass-panel rounded-2xl p-5 branch-card" style="border-left: 4px solid ${divDef.color || '#64748b'}">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <i class="fa-solid ${divDef.icon || 'fa-building'}" style="color:${divDef.color || '#94a3b8'}"></i>
            <h3 class="text-base font-bold text-white">${escapeHtml(divDef.division)}</h3>
            <span class="text-xs text-slate-500">${escapeHtml(divDef.shortName || '')}</span>
          </div>
          <span class="text-xs font-medium px-2 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            มีคนครอง ${filledCount} / ${rows.length} อัตรา
          </span>
        </div>
        <div class="space-y-1.5">${rowsHtml.join('')}</div>
      </div>
    `;
  });

  container.innerHTML = html || `<div class="glass-panel p-8 rounded-2xl text-center text-slate-400 text-sm">ไม่มีข้อมูลโครงสร้างตำแหน่ง</div>`;
}

/**
 * คำนวณและเรนเดอร์สถิติรวม (KPIs) และตัวเลขบนแท็บ
 */
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

  // Tab Badge counts
  setText('badge-count-all', total);
  setText('badge-count-army', armyCount);
  setText('badge-count-navy', navyCount);
  setText('badge-count-airforce', airCount);
  setText('badge-count-civil', civilCount);
  setText('badge-count-employee', empCount);
}

/**
 * เรนเดอร์การ์ดกำลังพล (Grid View)
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
        
        <!-- Top Branch & Tier Ribbon -->
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

        <!-- Personnel Profile Header -->
        <div class="flex items-start gap-3.5">
          <!-- Avatar Frame with Branch Ring -->
          <div class="avatar-frame avatar-frame-${p.branch} flex-shrink-0 w-16 h-16 relative shadow-md">
            <img src="${resolveAvatarUrl(p)}" alt="${p.rank} ${p.firstName}" class="w-full h-full object-cover" onerror="this.src='${getDefaultAvatarForBranch(p.branch)}'">
            <span class="absolute bottom-0 right-0 status-indicator ${statusInfo.className} ring-2 ring-slate-900" title="${statusInfo.label}"></span>
          </div>

          <!-- Name & Rank -->
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold text-amber-400 tracking-wide">${escapeHtml(p.rank)}</div>
            <h3 class="text-base font-bold text-white truncate group-hover:text-amber-300 transition">
              ${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}
            </h3>
            <p class="text-xs text-slate-400 truncate mt-0.5 flex items-center gap-1.5" title="${escapeHtml(p.position)}">
              <i class="fa-solid fa-briefcase text-[10px] text-slate-500 flex-shrink-0"></i>
              <span class="truncate">${escapeHtml(p.position) || 'ยังไม่ระบุตำแหน่ง'}</span>
            </p>
            ${p.secondedTo ? `
            <p class="text-[10px] text-amber-400 truncate mt-0.5 flex items-center gap-1.5" title="ช่วยราชการ ${escapeHtml(formatSecondedTo(p))}">
              <i class="fa-solid fa-right-left text-[9px] flex-shrink-0"></i>
              <span class="truncate">ช่วยราชการ ${escapeHtml(formatSecondedTo(p))}</span>
            </p>` : ''}
          </div>
        </div>

        <!-- Department / Division in Defense Energy Dept -->
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

        <!-- Action Buttons -->
        <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <button onclick="viewPersonnel('${p.id}')" class="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5">
            <i class="fa-solid fa-id-card text-amber-400"></i>
            <span>ดูประวัติ</span>
          </button>
          
          <div class="flex items-center gap-1">
            <button onclick="editPersonnel('${p.id}')" class="p-1.5 rounded-lg bg-slate-800/60 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 border border-slate-700/60 transition" title="แก้ไขข้อมูล">
              <i class="fa-solid fa-pen-to-square text-xs"></i>
            </button>
            <button onclick="deletePersonnelPrompt('${p.id}')" class="p-1.5 rounded-lg bg-slate-800/60 hover:bg-red-600/30 text-red-400 hover:text-red-300 border border-slate-700/60 transition" title="ลบข้อมูล">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </div>
        </div>

      </div>
    `;
  }).join('');
}

/**
 * เรนเดอร์ข้อมูลในรูปแบบตาราง (Table View)
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
        <!-- Personnel Info -->
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

        <!-- Rank & Tier -->
        <td class="py-3 px-3">
          <div class="font-semibold text-amber-400 text-xs">${escapeHtml(p.rank)}</div>
          <span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${tierBadge.className} mt-1">
            ${tierBadge.label}
          </span>
        </td>

        <!-- Branch -->
        <td class="py-3 px-3">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${branch.badgeClass}">
            <i class="fa-solid ${branch.icon} text-[10px]"></i>
            ${branch.nameTh}
          </span>
        </td>

        <!-- Department -->
        <td class="py-3 px-4 text-xs text-slate-300">
          <div class="max-w-[240px] truncate font-medium text-slate-200" title="${escapeHtml(p.department)}">${escapeHtml(p.department)}</div>
        </td>

        <!-- Position -->
        <td class="py-3 px-4 text-xs text-slate-300">
          <div class="max-w-[180px] truncate" title="${escapeHtml(p.position)}">${escapeHtml(p.position)}</div>
        </td>

        <!-- Status -->
        <td class="py-3 px-3 text-xs">
          <span class="inline-flex items-center gap-1.5">
            <span class="status-indicator ${statusInfo.className}"></span>
            <span class="text-slate-300">${statusInfo.label}</span>
          </span>
        </td>

        <!-- Actions -->
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="viewPersonnel('${p.id}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition" title="ดูประวัติ">
              <i class="fa-solid fa-id-card text-xs"></i>
            </button>
            <button onclick="editPersonnel('${p.id}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 transition" title="แก้ไข">
              <i class="fa-solid fa-pen-to-square text-xs"></i>
            </button>
            <button onclick="deletePersonnelPrompt('${p.id}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-red-400 hover:text-red-300 transition" title="ลบ">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ================= CRUD MODAL HANDLERS =================

/**
 * เปิด Modal เพิ่มกำลังพลใหม่
 */
function openAddModal() {
  document.getElementById('personnel-form').reset();
  document.getElementById('form-id').value = '';
  document.getElementById('form-modal-title').textContent = 'เพิ่มข้อมูลกำลังพลใหม่';
  document.getElementById('form-modal-icon').innerHTML = '<i class="fa-solid fa-user-plus text-emerald-400"></i>';
  
  // กำหนดรูปเริ่มต้น
  const defaultBranch = 'army';
  document.getElementById('form-branch').value = defaultBranch;
  document.getElementById('form-avatar-preview').src = DEFAULT_AVATARS.army_1;
  document.getElementById('form-avatar-url').value = '';

  // เติมตัวเลือกยศ
  updateFormRanks(defaultBranch);

  // ตั้งค่ากองและแผนกเริ่มต้น
  if (ENERGY_DEPT_STRUCTURE.length > 0) {
    document.getElementById('form-division').value = ENERGY_DEPT_STRUCTURE[0].division;
    handleFormDivisionChange(ENERGY_DEPT_STRUCTURE[0].division);
  }

  // เลขประจำตัวและปีที่เริ่มรับราชการ: ให้ผู้ใช้กรอกเองทั้งหมด ไม่เติมค่าอัตโนมัติ
  document.getElementById('form-service-id').value = '';
  document.getElementById('form-joined-year').value = '';

  // ไม่ได้ช่วยราชการโดยค่าเริ่มต้น
  const secondedSelect = document.getElementById('form-seconded-to');
  if (secondedSelect) secondedSelect.value = '';
  handleSecondedToChange('');

  const modal = document.getElementById('form-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/**
 * เปิด Modal แก้ไขข้อมูลกำลังพล
 */
function editPersonnel(id) {
  const p = personnelList.find(item => item.id === id);
  if (!p) return;

  document.getElementById('form-id').value = p.id;
  document.getElementById('form-modal-title').textContent = `แก้ไขข้อมูล: ${p.rank} ${p.firstName}`;
  document.getElementById('form-modal-icon').innerHTML = '<i class="fa-solid fa-pen-to-square text-blue-400"></i>';

  document.getElementById('form-branch').value = p.branch;
  updateFormRanks(p.branch, p.rank);

  document.getElementById('form-service-id').value = p.serviceId || '';
  document.getElementById('form-first-name').value = p.firstName || '';
  document.getElementById('form-last-name').value = p.lastName || '';
  document.getElementById('form-status').value = p.status || 'active';
  document.getElementById('form-joined-year').value = p.joinedYear || '';
  document.getElementById('form-phone').value = p.phone || '';
  document.getElementById('form-email').value = p.email || '';
  document.getElementById('form-notes').value = p.notes || '';

  // ตรวจสอบและแยก Division & Section จาก p.department
  const rawDept = p.department || '';
  let matchedDiv = ENERGY_DEPT_STRUCTURE[0].division;
  let matchedSec = '';

  for (const item of ENERGY_DEPT_STRUCTURE) {
    if (rawDept.includes(item.division)) {
      matchedDiv = item.division;
      for (const sec of item.sections) {
        if (rawDept.includes(sec)) {
          matchedSec = sec;
          break;
        }
      }
      break;
    }
  }

  const divSelect = document.getElementById('form-division');
  if (divSelect) {
    divSelect.value = matchedDiv;
    handleFormDivisionChange(matchedDiv, matchedSec);
  }

  // ตั้งค่าตำแหน่งเดิมลงในดรอปดาวน์ (หรือ "อื่นๆ" ถ้าไม่ตรงกับรายการมาตรฐาน) - ต้องทำหลังสร้างตัวเลือกตำแหน่งแล้วเท่านั้น
  // ไม่มีการแก้ไขค่าตำแหน่งเดิมของกำลังพล
  setFormPositionValue(p.position || '');

  // กองที่ไปช่วยราชการ (ถ้ามี)
  const secondedSelect = document.getElementById('form-seconded-to');
  if (secondedSelect) secondedSelect.value = p.secondedTo || '';
  handleSecondedToChange(p.secondedTo || '', p.secondedToSection || '');

  // รูปภาพ
  document.getElementById('form-avatar-preview').src = resolveAvatarUrl(p);
  document.getElementById('form-avatar-url').value = p.avatar && p.avatar.startsWith('http') ? convertToDirectImageUrl(p.avatar) : '';

  const modal = document.getElementById('form-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeFormModal() {
  const modal = document.getElementById('form-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

/**
 * จัดการเมื่อเปลี่ยนเหล่าทัพใน Form
 */
function handleFormBranchChange(branch) {
  let defaultAv = DEFAULT_AVATARS.army_1;

  if (branch === 'navy') {
    defaultAv = DEFAULT_AVATARS.navy_1;
  } else if (branch === 'airforce') {
    defaultAv = DEFAULT_AVATARS.air_1;
  } else if (branch === 'civil') {
    defaultAv = DEFAULT_AVATARS.civil_1;
  } else if (branch === 'employee') {
    defaultAv = DEFAULT_AVATARS.emp_1;
  }

  if (!document.getElementById('form-id').value) {
    document.getElementById('form-avatar-preview').src = defaultAv;
  }

  // เลขประจำตัวกรอกเองทั้งหมด (ตัวเลข 10 หลัก ไม่มีคำนำหน้าเหล่าทัพ) จึงไม่ต้องปรับค่าตามเหล่าทัพที่เลือก

  updateFormRanks(branch);
}

/**
 * เติมตัวเลือกยศใน Modal Form
 */
function updateFormRanks(branch, selectedRank = null) {
  const rankSelect = document.getElementById('form-rank');
  const ranks = getRanksByBranch(branch);

  if (rankSelect) {
    rankSelect.innerHTML = ranks.map(r => {
      const isSel = selectedRank ? (r.rank === selectedRank) : false;
      return `<option value="${escapeHtml(r.rank)}" data-tier="${r.tier}" ${isSel ? 'selected' : ''}>${r.rank} (${r.titleEn}) - Tier ${r.tier}</option>`;
    }).join('');

    // Trigger tier update
    const currentRank = rankSelect.value;
    handleFormRankChange(currentRank);
  }
}

/**
 * เมื่อเลือกยศใน Form -> อัปเดต Tier Preview อัตโนมัติ
 */
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
    // ติด CORS หรือโหลดไม่ได้ — เปิดรูปในแท็บใหม่ให้ผู้ใช้กดบันทึกเอง
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
 * ดาวน์โหลดรูปที่แสดงอยู่ในช่อง preview ของฟอร์มเพิ่ม/แก้ไขข้อมูล (ไฟล์ที่เพิ่งเลือก/บันทึกไว้)
 */
function downloadCurrentFormAvatar() {
  const preview = document.getElementById('form-avatar-preview');
  const rawUrl = document.getElementById('form-avatar-url') ? document.getElementById('form-avatar-url').value : '';
  // ถ้ามีลิงก์ Drive ที่บันทึกไว้แล้ว ให้ดาวน์โหลดไฟล์ต้นฉบับผ่านลิงก์นั้น ไม่ใช่ thumbnail ที่ preview ใช้แสดงผล
  const url = rawUrl ? resolveAvatarDownloadUrl({ avatar: rawUrl }) : (preview ? preview.src : '');
  const nameInput = (document.getElementById('form-first-name') || {}).value || 'avatar';
  downloadImageFromUrl(url, `avatar-${nameInput}.jpg`);
}

function handleImageUrlInput(url) {
  if (url && url.trim().length > 5) {
    const directUrl = convertToDirectImageUrl(url);
    document.getElementById('form-avatar-preview').src = directUrl;
    document.getElementById('form-avatar-url').value = directUrl;
  }
}

/**
 * บันทึกข้อมูลกำลังพล (Submit Form)
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  handleFormSectionChange(); // Ensure department string is composed

  const id = document.getElementById('form-id').value;
  const branch = document.getElementById('form-branch').value;
  const rank = document.getElementById('form-rank').value;
  const rankTier = parseInt(document.getElementById('form-rank-tier').value, 10) || getRankTier(rank, branch);
  const firstName = document.getElementById('form-first-name').value.trim();
  const lastName = document.getElementById('form-last-name').value.trim();
  const serviceId = document.getElementById('form-service-id').value.trim();
  const department = document.getElementById('form-department').value.trim();
  const position = getFormPositionValue();
  const status = document.getElementById('form-status').value;
  const secondedToSelect = document.getElementById('form-seconded-to');
  const secondedTo = secondedToSelect ? secondedToSelect.value.trim() : '';
  const secondedSectionSelect = document.getElementById('form-seconded-section');
  const secondedToSection = secondedTo && secondedSectionSelect ? secondedSectionSelect.value.trim() : '';
  const homeDivision = document.getElementById('form-division').value;
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

  if (secondedTo && secondedTo === homeDivision) {
    showToast('กองที่ไปช่วยราชการต้องไม่ใช่กองต้นสังกัดเดียวกัน', 'error');
    return;
  }

  const recordId = id || generateNextPersonnelId();

  // ถ้าเพิ่งอัปโหลดรูปใหม่ (ยังเป็น Base64 อยู่) ให้อัปโหลดขึ้น Google Drive ก่อน แล้วเอาลิงก์มาใช้แทน
  if (avatar && avatar.startsWith('data:')) {
    try {
      showToast('กำลังอัปโหลดรูปภาพขึ้นระบบคลาวด์...', 'info');
      const mimeType = avatar.substring(5, avatar.indexOf(';'));
      const ext = mimeType.split('/')[1] || 'jpg';
      avatar = await uploadPhotoToCloud(avatar, `${recordId}.${ext}`, mimeType);
    } catch (err) {
      showToast(`อัปโหลดรูปภาพไม่สำเร็จ: ${err.message}`, 'error');
      return;
    }
  }

  let recordToSave;

  if (id) {
    // แก้ไขข้อมูลเดิม (Update)
    const idx = personnelList.findIndex(p => p.id === id);
    if (idx !== -1) {
      personnelList[idx] = {
        ...personnelList[idx],
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
        avatar,
        secondedTo,
        secondedToSection
      };
      recordToSave = personnelList[idx];
    }
  } else {
    // เพิ่มกำลังพลใหม่ (Create)
    const newPersonnel = {
      id: recordId,
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
      avatar,
      secondedTo,
      secondedToSection
    };
    personnelList.unshift(newPersonnel);
    recordToSave = newPersonnel;
  }

  try {
    await savePersonnelToCloud(recordToSave);
    saveData(); // อัปเดตแคช LocalStorage ด้วย
    showToast(id ? `อัปเดตข้อมูล ${rank} ${firstName} สำเร็จ` : `เพิ่มกำลังพล ${rank} ${firstName} เรียบร้อย`, 'success');
  } catch (err) {
    showToast(`บันทึกข้อมูลไม่สำเร็จ: ${err.message}`, 'error');
    return;
  }

  closeFormModal();
  renderApp();
}


// ================= VIEW PROFILE CARD MODAL =================

/**
 * เปิด Modal ดูบัตรประจำตัวและประวัติกำลังพล
 */
function viewPersonnel(id) {
  const p = personnelList.find(item => item.id === id);
  if (!p) return;

  currentViewingId = id;
  const branch = BRANCH_INFO[p.branch] || BRANCH_INFO.army;
  const tierBadge = getRankTierBadge(p.rankTier, p.branch, p.rank);
  const statusInfo = getStatusInfo(p.status);

  const container = document.getElementById('view-card-content');
  if (container) {
    container.innerHTML = `
      <div class="military-id-card rounded-2xl p-6 relative shadow-2xl border border-slate-700">
        
        <!-- Watermark -->
        <i class="fa-solid ${branch.icon} watermark-emblem text-slate-400"></i>

        <!-- Top Header of ID Card -->
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

        <!-- Main Body of Card -->
        <div class="flex flex-col sm:flex-row items-center sm:items-start gap-5 my-5">
          <!-- Portrait Photo -->
          <div class="w-28 h-36 rounded-xl overflow-hidden border-2 border-amber-500/80 shadow-lg flex-shrink-0 bg-slate-950">
            <img src="${resolveAvatarUrl(p)}" alt="${p.firstName}" class="w-full h-full object-cover" onerror="this.src='${getDefaultAvatarForBranch(p.branch)}'">
          </div>

          <!-- Personnel Info Sheet -->
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
              ${p.secondedTo ? `
              <div class="col-span-2">
                <span class="text-slate-500 block text-[10px]">ช่วยปฏิบัติราชการ:</span>
                <span class="inline-flex items-center gap-1.5 font-semibold text-sky-300">
                  <i class="fa-solid fa-right-left text-[10px]"></i> ${escapeHtml(formatSecondedTo(p))}
                </span>
              </div>` : ''}
            </div>
          </div>
        </div>

        <!-- Extra Details (Contact, Joined Year, Notes) -->
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

        <!-- Barcode Decorative Mock -->
        <div class="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
          <span>DED-ID-${p.serviceId}</span>
          <span class="tracking-widest">||| | ||||| || ||| |||| | |||</span>
          <span>DEFENSE ENERGY DEPT</span>
        </div>

      </div>
    `;
  }

  // ผูกปุ่ม Edit และ Delete ใน View Modal
  const editBtn = document.getElementById('view-edit-btn');
  const deleteBtn = document.getElementById('view-delete-btn');
  
  if (editBtn) {
    editBtn.onclick = () => {
      closeViewModal();
      editPersonnel(id);
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = () => {
      closeViewModal();
      deletePersonnelPrompt(id);
    };
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

// ================= DELETE MODAL HANDLERS =================

function deletePersonnelPrompt(id) {
  const p = personnelList.find(item => item.id === id);
  if (!p) return;

  currentDeletingId = id;
  const preview = document.getElementById('delete-modal-preview');
  if (preview) {
    preview.innerHTML = `
      <div class="flex items-center gap-3">
        <img src="${resolveAvatarUrl(p)}" class="w-10 h-10 rounded-full object-cover border border-slate-700">
        <div>
          <div class="font-bold text-white">${p.rank} ${p.firstName} ${p.lastName}</div>
          <div class="text-slate-400">${p.position} • ${p.department}</div>
        </div>
      </div>
    `;
  }

  const confirmBtn = document.getElementById('confirm-delete-btn');
  if (confirmBtn) {
    confirmBtn.onclick = () => executeDeletePersonnel(id);
  }

  const modal = document.getElementById('delete-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeDeleteModal() {
  const modal = document.getElementById('delete-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  currentDeletingId = null;
}

async function executeDeletePersonnel(id) {
  const p = personnelList.find(item => item.id === id);
  try {
    await deletePersonnelFromCloud(id);
  } catch (err) {
    showToast(`ลบข้อมูลไม่สำเร็จ: ${err.message}`, 'error');
    return;
  }
  personnelList = personnelList.filter(item => item.id !== id);
  saveData(); // อัปเดตแคช LocalStorage ด้วย
  closeDeleteModal();
  renderApp();
  showToast(`ลบข้อมูล ${p ? p.rank + ' ' + p.firstName : ''} เรียบร้อยแล้ว`, 'info');
}

// ================= BACKUP / EXPORT / IMPORT =================

/**
 * ส่งออกไฟล์ JSON สำหรับสำรองข้อมูล
 * (แปลงรูปภาพที่อ้างอิงจากไฟล์ในโฟลเดอร์ให้เป็น Base64 ฝังในไฟล์ JSON ด้วย
 *  เพื่อให้ไฟล์สำรองนี้เปิดใช้ได้ครบถ้วนในตัวเองบนทุกเครื่อง/เบราว์เซอร์)
 */
async function exportData() {
  showToast('กำลังเตรียมไฟล์สำรองข้อมูล...', 'info');

  const dataStr = JSON.stringify(personnelList, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `defense_energy_personnel_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('ส่งออกไฟล์สำรองข้อมูล JSON สำเร็จ', 'success');
}

/**
 * เปิด Modal นำเข้าข้อมูล
 */
function openImportModal() {
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-text-input').value = '';
  const modal = document.getElementById('import-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeImportModal() {
  const modal = document.getElementById('import-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('import-text-input').value = e.target.result;
  };
  reader.readAsText(file);
}

/**
 * นำเข้าข้อมูล JSON — ส่งขึ้น Google Sheet ทีละคน (เพิ่ม/อัปเดต)
 * หมายเหตุ: การนำเข้าแบบนี้จะ "เพิ่มหรืออัปเดต" ตาม id ที่ตรงกัน แต่จะไม่ลบรายการที่มีอยู่ใน Sheet
 * แล้วไม่ได้อยู่ใน JSON ที่นำเข้า (ต่างจากพฤติกรรมเดิมที่ทับข้อมูลทั้งหมด) เพื่อป้องกันข้อมูลหายโดยไม่ตั้งใจ
 */
async function executeImportJSON() {
  const text = document.getElementById('import-text-input').value.trim();
  if (!text) {
    showToast('กรุณาระบุข้อมูล JSON', 'error');
    return;
  }

  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error('ข้อมูลต้องเป็น Array ของรายการกำลังพล');
    }

    if (data.length > 0 && (!data[0].firstName || !data[0].rank)) {
      throw new Error('โครงสร้างข้อมูลไม่ถูกต้อง');
    }

    showToast(`กำลังนำเข้าข้อมูล ${data.length} รายการขึ้นคลาวด์...`, 'info');
    let successCount = 0;
    for (const record of data) {
      try {
        await savePersonnelToCloud(record);
        successCount++;
      } catch (err) {
        console.error('นำเข้ารายการล้มเหลว:', record.id, err);
      }
    }

    await initData(); // โหลดข้อมูลล่าสุดจากคลาวด์กลับมาแสดง
    closeImportModal();
    renderApp();
    showToast(`นำเข้าข้อมูลสำเร็จ ${successCount}/${data.length} รายการ`, successCount === data.length ? 'success' : 'error');
  } catch (err) {
    showToast(`นำเข้าข้อมูลล้มเหลว: ${err.message}`, 'error');
  }
}

/**
 * โหลดข้อมูลล่าสุดจาก Google Sheet ใหม่ (แทนที่การ "รีเซ็ตเป็นค่าเริ่มต้น" แบบเดิม
 * ซึ่งจะทับข้อมูลจริงบน Sheet — จึงเปลี่ยนเป็นดึงข้อมูลปัจจุบันจากคลาวด์มาแสดงใหม่แทน เพื่อความปลอดภัยของข้อมูล)
 */
async function resetDataWithConfirm() {
  if (confirm('ต้องการโหลดข้อมูลกำลังพลล่าสุดจากฐานข้อมูลคลาวด์ใหม่หรือไม่? (การเปลี่ยนแปลงที่ยังไม่บันทึกในหน้าจอนี้จะหายไป)')) {
    try {
      await initData();
      clearAllFilters();
      renderApp();
      showToast('โหลดข้อมูลล่าสุดจากคลาวด์เรียบร้อยแล้ว', 'info');
    } catch (err) {
      showToast(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`, 'error');
    }
  }
}

// ================= UTILITIES & HELPERS =================

function getRankTierBadge(tier, branch, rank = '') {
  if (branch === 'civil' || rank.startsWith('ขรก.พลเรือนกลาโหม')) {
    return {
      className: 'tier-civil',
      label: `ขรก.พลเรือน (Tier ${tier})`,
      icon: '<i class="fa-solid fa-user-tie text-purple-400"></i>'
    };
  }

  if (branch === 'employee' || rank.includes('พนักงาน') || rank.includes('ลูกจ้าง')) {
    return {
      className: 'tier-employee',
      label: `พนง.พลังงานทหาร (Tier ${tier})`,
      icon: '<i class="fa-solid fa-building-user text-amber-400"></i>'
    };
  }

  if (tier <= 4) {
    return {
      className: 'tier-general',
      label: `ชั้นนายพล (Tier ${tier})`,
      icon: '<i class="fa-solid fa-star text-amber-400"></i>'
    };
  } else if (tier <= 8) {
    return {
      className: 'tier-field',
      label: `สัญญาบัตร (Tier ${tier})`,
      icon: '<i class="fa-solid fa-shield text-slate-300"></i>'
    };
  } else if (tier <= 11) {
    return {
      className: 'tier-company',
      label: `สัญญาบัตรต้น (Tier ${tier})`,
      icon: '<i class="fa-solid fa-chevron-up text-amber-200"></i>'
    };
  } else if (tier <= 18) {
    return {
      className: 'tier-nco',
      label: `ประทวน (Tier ${tier})`,
      icon: '<i class="fa-solid fa-bars text-slate-400"></i>'
    };
  } else {
    return {
      className: 'tier-employee',
      label: `พนง.พลังงานทหาร (Tier ${tier})`,
      icon: '<i class="fa-solid fa-building-user text-amber-400"></i>'
    };
  }
}

function getStatusInfo(status) {
  switch (status) {
    case 'active':
      return { label: 'ปฏิบัติหน้าที่ปกติ', className: 'status-active' };
    case 'duty':
      return { label: 'ไปราชการ / ฝึกภาคสนาม', className: 'status-duty' };
    case 'leave':
      return { label: 'ลาพัก / ศึกษาต่อ', className: 'status-leave' };
    case 'retired':
      return { label: 'ปลดประจำการ / พ้นสภาพ', className: 'status-retired' };
    default:
      return { label: 'ปฏิบัติหน้าที่ปกติ', className: 'status-active' };
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

/**
 * Toast Notification System
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  let icon = 'fa-circle-info text-blue-400';
  let borderColor = 'border-slate-700';

  if (type === 'success') {
    icon = 'fa-circle-check text-emerald-400';
    borderColor = 'border-emerald-500/40';
  } else if (type === 'error') {
    icon = 'fa-circle-exclamation text-red-400';
    borderColor = 'border-red-500/40';
  }

  toast.className = `p-3.5 rounded-xl bg-slate-900/95 text-slate-100 text-xs shadow-2xl border ${borderColor} flex items-center space-x-2.5 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  toast.innerHTML = `
    <i class="fa-solid ${icon} text-base"></i>
    <span class="font-medium">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Animation in
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3500);
}
