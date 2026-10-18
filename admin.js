// 관리자 콘솔 스크립트 (Supabase 연동 & GitHub Pages 지원)

let adminToken = localStorage.getItem('admin_token') || '';
let currentAdminUser = null;

// 관리자 기본 비밀번호 (비상용 로컬 마스터 키)
const ADMIN_MASTER_PW = 'admin2026!';

document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  initAdminLoginForm();
  initCreateSubjectModal();
  initChangeAdminPwForm();
});

function getAdminHeaders() {
  const headers = {};
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  return headers;
}

// ------------------- 관리자 인증 -------------------

async function checkAdminAuth() {
  // 1. Supabase 세션 확인
  if (typeof supabaseGetCurrentUser === 'function') {
    try {
      const user = await supabaseGetCurrentUser();
      if (user && user.role === 'admin') {
        currentAdminUser = user;
        showAdminLoginModal(false);
        refreshAdminDashboard();
        return;
      }
    } catch (e) {}
  }

  // 2. 로컬 관리자 토큰 확인
  if (adminToken === 'local_admin_session') {
    showAdminLoginModal(false);
    refreshAdminDashboard();
    return;
  }

  // 3. 기존 서버 API 확인 시도
  if (adminToken) {
    try {
      const res = await fetch('/api/auth/me', { headers: getAdminHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user.role === 'admin') {
          showAdminLoginModal(false);
          refreshAdminDashboard();
          return;
        }
      }
    } catch (e) {}
  }

  showAdminLoginModal(true);
}

function showAdminLoginModal(show) {
  const modal = document.getElementById('adminLoginModal');
  if (!modal) return;
  if (show) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  } else {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function initAdminLoginForm() {
  const form = document.getElementById('adminLoginForm');
  const uInput = document.getElementById('adminUsername');
  const pInput = document.getElementById('adminPassword');
  const errEl = document.getElementById('adminLoginError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');

    const u = uInput.value.trim();
    const p = pInput.value;

    // 1. Supabase 로그인 시도 (admin 계정)
    if (typeof supabaseLogin === 'function') {
      try {
        const res = await supabaseLogin(u, p);
        if (res.success && res.user.role === 'admin') {
          currentAdminUser = res.user;
          adminToken = 'supabase_admin';
          localStorage.setItem('admin_token', adminToken);
          showAdminLoginModal(false);
          refreshAdminDashboard();
          return;
        }
      } catch (err) {
        // 계속 진행하여 마스터 비밀번호 검사
      }
    }

    // 2. 마스터 관리자 비밀번호 검사 (비상용 또는 관리자 직접 접근)
    if ((u === 'admin' || u.toLowerCase().includes('admin')) && p === ADMIN_MASTER_PW) {
      adminToken = 'local_admin_session';
      localStorage.setItem('admin_token', adminToken);
      showAdminLoginModal(false);
      refreshAdminDashboard();
      return;
    }

    // 3. 기존 백엔드 서버가 있는 경우
    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        adminToken = data.token;
        localStorage.setItem('admin_token', adminToken);
        showAdminLoginModal(false);
        refreshAdminDashboard();
        return;
      }
    } catch (err) {}

    errEl.textContent = '관리자 아이디 또는 비밀번호가 올바르지 않습니다.';
    errEl.classList.remove('hidden');
  });
}

function adminLogout() {
  if (confirm('관리자 세션을 로그아웃 하시겠습니까?')) {
    localStorage.removeItem('admin_token');
    adminToken = '';
    if (typeof supabaseLogout === 'function') {
      supabaseLogout();
    }
    window.location.reload();
  }
}

function switchAdminTab(tabName) {
  ['users', 'subjects', 'security'].forEach(t => {
    const tabEl = document.getElementById(`atab-${t}`);
    const panelEl = document.getElementById(`apanel-${t}`);
    if (tabEl) tabEl.className = 'pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
    if (panelEl) panelEl.classList.add('hidden');
  });

  const activeBtn = document.getElementById(`atab-${tabName}`);
  const activePanel = document.getElementById(`apanel-${tabName}`);
  if (activeBtn) activeBtn.className = 'pb-3 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
  if (activePanel) activePanel.classList.remove('hidden');
}

// ------------------- 대시보드 데이터 로드 -------------------

async function refreshAdminDashboard() {
  try { await loadStats(); } catch (e) { console.warn('loadStats warning:', e); }
  try { await loadUsers(); } catch (e) { console.warn('loadUsers warning:', e); }
  try { await loadSubjects(); } catch (e) { console.warn('loadSubjects warning:', e); }
}

async function loadStats() {
  try {
    let pendingCount = 0;
    let approvedCount = 0;

    // 1. Supabase profiles 테이블에서 카운트 조회
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const { data: profiles, error } = await supabaseClient.from('profiles').select('status');
        if (!error && profiles) {
          pendingCount = profiles.filter(p => p.status === 'pending').length;
          approvedCount = profiles.filter(p => p.status === 'approved').length;
        }
      } catch (e) {}
    }

    // 2. 서버 API 백업 시도
    if (pendingCount === 0 && approvedCount === 0) {
      try {
        const res = await fetch('/api/admin/stats', { headers: getAdminHeaders() });
        if (res.ok) {
          const stats = await res.json();
          pendingCount = stats.pending_users || 0;
          approvedCount = stats.approved_users || 0;
        }
      } catch (e) {}
    }

    document.getElementById('statPendingUsers').textContent = pendingCount;
    document.getElementById('statApprovedUsers').textContent = approvedCount;

    const badge = document.getElementById('badgePendingCount');
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    // 과목/문서 통계
    const subs = await fetchJsonWithFallback('/api/subjects', './data/subjects.json');
    const docs = await fetchJsonWithFallback('/api/lectures', './data/lectures.json');
    const exams = await fetchJsonWithFallback('/api/exams', './data/exams.json');

    document.getElementById('statTotalSubjects').textContent = (subs ? subs.length : 1);
    document.getElementById('statTotalDocs').textContent = ((docs ? docs.length : 0) + (exams ? exams.length : 0));

  } catch (err) {
    console.error('Stats loading failed:', err);
  }
}

async function loadUsers() {
  try {
    let users = [];

    // 1. Supabase profiles 테이블에서 사용자 전체 목록 조회
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data) {
          users = data.map(d => ({
            id: d.id,
            username: d.email ? d.email.split('@')[0] : d.name,
            name: d.name || d.email,
            status: d.status || 'pending',
            role: d.role || 'user',
            note: d.note || '',
            created_at: d.created_at ? d.created_at.replace('T', ' ').slice(0, 16) : '-'
          }));
        }
      } catch (e) {
        console.warn('Supabase profiles load failed:', e);
      }
    }

    // 2. 서버 API 백업 조회
    if (users.length === 0) {
      try {
        const res = await fetch('/api/admin/users', { headers: getAdminHeaders() });
        if (res.ok) {
          users = await res.json();
        }
      } catch (e) {}
    }

    // 1. 승인 대기자 목록
    const pending = users.filter(u => u.status === 'pending');
    document.getElementById('pendingListCountText').textContent = `${pending.length}건 대기 중`;

    const pendingBody = document.getElementById('pendingUsersBody');
    if (pending.length === 0) {
      pendingBody.innerHTML = `<tr><td colspan="5" class="px-6 py-6 text-center text-slate-500 text-xs">현재 대기 중인 가입 신청이 없습니다.</td></tr>`;
    } else {
      pendingBody.innerHTML = pending.map(u => `
        <tr class="hover:bg-slate-800/50">
          <td class="px-6 py-3.5 font-bold text-white">${escapeHtml(u.name)}</td>
          <td class="px-6 py-3.5 font-mono text-xs text-indigo-300">${escapeHtml(u.username)}</td>
          <td class="px-6 py-3.5 text-xs text-slate-300">${escapeHtml(u.note || '-')}</td>
          <td class="px-6 py-3.5 text-xs text-slate-400">${u.created_at || '-'}</td>
          <td class="px-6 py-3.5 text-right space-x-2">
            <button onclick="setUserStatus('${u.id}', 'approved')" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition">
              <i class="fa-solid fa-check text-[10px]"></i> 승인
            </button>
            <button onclick="setUserStatus('${u.id}', 'rejected')" class="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow transition">
              <i class="fa-solid fa-xmark text-[10px]"></i> 거절
            </button>
          </td>
        </tr>
      `).join('');
    }

    // 2. 전체 이용자 목록
    const allBody = document.getElementById('allUsersBody');
    if (users.length === 0) {
      allBody.innerHTML = `<tr><td colspan="6" class="px-6 py-6 text-center text-slate-500 text-xs">등록된 회원이 없습니다.</td></tr>`;
    } else {
      allBody.innerHTML = users.map(u => {
        let statusBadge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">승인 대기</span>';
        if (u.status === 'approved') {
          statusBadge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">이용 승인됨</span>';
        } else if (u.status === 'rejected') {
          statusBadge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">이용 거절/정지</span>';
        }

        return `
          <tr class="hover:bg-slate-800/50">
            <td class="px-6 py-3.5 font-semibold text-white">${escapeHtml(u.name)}</td>
            <td class="px-6 py-3.5 font-mono text-xs text-slate-300">${escapeHtml(u.username)}</td>
            <td class="px-6 py-3.5">${statusBadge}</td>
            <td class="px-6 py-3.5 text-xs text-slate-400">${escapeHtml(u.note || '-')}</td>
            <td class="px-6 py-3.5 text-xs text-slate-400">${u.created_at || '-'}</td>
            <td class="px-6 py-3.5 text-right space-x-1.5">
              ${u.status === 'approved' ? `
                <button onclick="setUserStatus('${u.id}', 'rejected')" class="px-2.5 py-1 text-xs text-amber-400 hover:bg-amber-400/10 rounded border border-amber-400/30">
                  권한 정지
                </button>
              ` : `
                <button onclick="setUserStatus('${u.id}', 'approved')" class="px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-400/10 rounded border border-emerald-400/30">
                  이용 승인
                </button>
              `}
              <button onclick="deleteUser('${u.id}')" class="px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-400/10 rounded border border-rose-400/30">
                삭제
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('Users load failed:', err);
  }
}

// ------------------- 승인 / 거절 / 삭제 -------------------

async function setUserStatus(userId, status) {
  const actionText = status === 'approved' ? '승인' : '거절/정지';
  if (!confirm(`이 회원을 ${actionText} 처리하시겠습니까?`)) return;

  // 1. Supabase profiles 업데이트
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('profiles')
        .update({ status: status })
        .eq('id', userId);
      if (!error) {
        alert(`${actionText} 처리가 완료되었습니다.`);
        refreshAdminDashboard();
        return;
      }
    } catch (e) {}
  }

  // 2. 서버 API 백업 호출
  try {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      headers: { ...getAdminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      alert(`${actionText} 처리가 완료되었습니다.`);
      refreshAdminDashboard();
    } else {
      alert('상태 변경 실패');
    }
  } catch (err) {
    alert('통신 오류');
  }
}

async function deleteUser(userId) {
  if (!confirm('정말로 이 회원을 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) return;

  // 1. Supabase 삭제
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('profiles')
        .delete()
        .eq('id', userId);
      if (!error) {
        alert('회원이 삭제되었습니다.');
        refreshAdminDashboard();
        return;
      }
    } catch (e) {}
  }

  // 2. 서버 API 삭제
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    if (res.ok) {
      alert('회원이 삭제되었습니다.');
      refreshAdminDashboard();
    } else {
      alert('삭제 실패');
    }
  } catch (err) {
    alert('삭제 통신 오류');
  }
}

// ------------------- 과목 및 자료/족보 관리 -------------------

async function loadSubjects() {
  try {
    let subs = await fetchJsonWithFallback('/api/subjects', './data/subjects.json');
    let staticDocs = await fetchJsonWithFallback('/api/lectures', './data/lectures.json') || [];
    let staticExams = await fetchJsonWithFallback('/api/exams', './data/exams.json') || [];

    // Supabase shared_lectures, shared_exams, exam_overrides 실시간 조회
    let cloudDocs = [];
    let cloudExams = [];
    let cloudOverrides = [];
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const { data: cD } = await supabaseClient.from('shared_lectures').select('*').order('uploaded_at', { ascending: false });
        if (cD) cloudDocs = cD;
      } catch (e) {}
      try {
        const { data: cE } = await supabaseClient.from('shared_exams').select('*').order('created_at', { ascending: false });
        if (cE) cloudExams = cE;
      } catch (e) {}
      try {
        const { data: cO } = await supabaseClient.from('exam_overrides').select('*');
        if (cO) cloudOverrides = cO;
      } catch (e) {}
    }

    // 클라우드 삭제 목록 파싱 (모든 브라우저/기기간 실시간 동기화)
    const cloudDeletedLectureIds = new Set();
    const cloudDeletedExamIds = new Set();
    cloudOverrides.forEach(item => {
      if (item.exam_data && item.exam_data.is_deleted) {
        if (item.exam_id && item.exam_id.startsWith('deleted_lec_')) {
          cloudDeletedLectureIds.add(item.exam_id.replace('deleted_lec_', ''));
          if (item.exam_data.id) cloudDeletedLectureIds.add(item.exam_data.id);
        } else {
          cloudDeletedExamIds.add(item.exam_id);
          if (item.exam_data.id) cloudDeletedExamIds.add(item.exam_data.id);
        }
      }
    });

    const deletedDocs = JSON.parse(localStorage.getItem('deleted_lectures') || '[]');
    const deletedExams = JSON.parse(localStorage.getItem('deleted_exams') || '[]');
    deletedDocs.forEach(id => cloudDeletedLectureIds.add(id));
    deletedExams.forEach(id => cloudDeletedExamIds.add(id));

    const docMap = new Map();
    cloudDocs.forEach(d => { if (!cloudDeletedLectureIds.has(d.id)) docMap.set(d.id, d); });
    staticDocs.forEach(d => { if (!cloudDeletedLectureIds.has(d.id) && !docMap.has(d.id)) docMap.set(d.id, d); });
    let docs = Array.from(docMap.values());

    const examMap = new Map();
    cloudExams.forEach(e => { if (!cloudDeletedExamIds.has(e.id) && !e.is_deleted) examMap.set(e.id, e); });
    staticExams.forEach(e => { if (!cloudDeletedExamIds.has(e.id) && !e.is_deleted && !examMap.has(e.id)) examMap.set(e.id, e); });
    let exams = Array.from(examMap.values());
    adminLoadedExams = exams;

    if (!subs || subs.length === 0) {
      subs = [{
        id: "sub_fbdc79d0",
        name: "의학세포분자생물학",
        description: "2026년 예과 1학년 2학기",
        created_at: "2026-10-10 01:31"
      }];
    }

    const body = document.getElementById('adminSubjectsBody') || document.getElementById('subjectsBody');
    if (body) {
      body.innerHTML = subs.map(s => `
        <tr class="hover:bg-slate-800/50">
          <td class="px-6 py-3.5 font-bold text-white">${escapeHtml(s.name)}</td>
          <td class="px-6 py-3.5 text-xs text-slate-300">${escapeHtml(s.description || '-')}</td>
          <td class="px-6 py-3.5 text-xs text-indigo-400 font-semibold">
            강의자료 ${docs.length || s.lecture_count || 0}개
          </td>
          <td class="px-6 py-3.5 text-xs text-cyan-400 font-semibold">
            족보 ${exams.length || s.exam_count || 0}세트
          </td>
          <td class="px-6 py-3.5 text-right text-xs text-slate-500">
            기본 과목
          </td>
        </tr>
      `).join('');
    }

    // 1. 등록된 강의 자료 목록 렌더링
    const lecBody = document.getElementById('adminLecturesBody');
    const lecCountText = document.getElementById('adminLecturesCountText');
    if (lecCountText) lecCountText.textContent = `총 ${docs.length}개 강의 문서`;
    if (lecBody) {
      if (docs.length === 0) {
        lecBody.innerHTML = `<tr><td colspan="4" class="px-6 py-6 text-center text-slate-500 text-xs">등록된 강의 자료가 없습니다.</td></tr>`;
      } else {
        lecBody.innerHTML = docs.map(d => `
          <tr class="hover:bg-slate-800/50 transition">
            <td class="px-6 py-3.5 font-medium text-white flex items-center gap-2">
              <i class="fa-regular fa-file-powerpoint text-indigo-400"></i>
              <span>${escapeHtml(d.filename)}</span>
            </td>
            <td class="px-6 py-3.5">
              <span class="px-2 py-0.5 text-xs font-semibold rounded bg-slate-700 text-slate-300">${escapeHtml(d.unit_type || '슬라이드')}</span>
            </td>
            <td class="px-6 py-3.5 font-semibold text-slate-300 text-xs">${d.unit_count || (d.units ? d.units.length : 0)}개</td>
            <td class="px-6 py-3.5 text-xs text-slate-400">${escapeHtml(d.uploaded_by || '관리자')} (${d.uploaded_at || '-'})</td>
            <td class="px-6 py-3.5 text-right">
              <button onclick="deleteAdminLecture('${d.id}')" class="px-2.5 py-1.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold shadow transition inline-flex items-center gap-1.5">
                <i class="fa-solid fa-trash-can text-[10px]"></i>
                <span>삭제</span>
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // 2. 등록된 족보 세트 목록 렌더링
    const exBody = document.getElementById('adminExamsBody');
    const exCountText = document.getElementById('adminExamsCountText');
    if (exCountText) exCountText.textContent = `총 ${exams.length}개 족보 세트`;
    if (exBody) {
      if (exams.length === 0) {
        exBody.innerHTML = `<tr><td colspan="5" class="px-6 py-6 text-center text-slate-500 text-xs">등록된 족보 세트가 없습니다.</td></tr>`;
      } else {
        exBody.innerHTML = exams.map(e => `
          <tr class="hover:bg-slate-800/50 transition">
            <td class="px-6 py-3.5 font-semibold text-white flex items-center gap-2">
              <i class="fa-solid fa-file-signature text-cyan-400"></i>
              <span>${escapeHtml(e.title)}</span>
            </td>
            <td class="px-6 py-3.5 font-bold text-xs text-indigo-300">
              ${e.question_count || (e.questions ? e.questions.length : 0)}문항
            </td>
            <td class="px-6 py-3.5 text-xs text-emerald-400 font-semibold">
              <i class="fa-solid fa-check-circle"></i> 정답표 등록 완료
            </td>
                        <td class="px-6 py-3.5 text-xs text-slate-400">${escapeHtml(e.created_by || '관리자')} (${e.created_at || '-'})</td>
            <td class="px-6 py-3.5 text-right space-x-1.5">
              <button onclick="openAdminAnswerKeyModal('${e.id}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow transition inline-flex items-center gap-1.5">
                <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                <span>문제 및 정답 수정</span>
              </button>
              <button onclick="deleteAdminExam('${e.id}')" class="px-2.5 py-1.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold shadow transition inline-flex items-center gap-1.5">
                <i class="fa-solid fa-trash-can text-[10px]"></i>
                <span>삭제</span>
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Subjects load error:', err);
  }
}

function initCreateSubjectModal() {
  const form = document.getElementById('createSubjectForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('새 과목 개설은 백엔드 데이터베이스 연결 시 제공됩니다.');
    closeCreateSubjectModal();
  });
}

function openCreateSubjectModal() {
  const modal = document.getElementById('createSubjectModal');
  if (modal) modal.classList.remove('hidden');
}

function closeCreateSubjectModal() {
  const modal = document.getElementById('createSubjectModal');
  if (modal) modal.classList.add('hidden');
}

function initChangeAdminPwForm() {
  const form = document.getElementById('adminChangePwForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('비밀번호 변경이 반영되었습니다.');
  });
}

// ------------------- 유틸 -------------------

async function fetchJsonWithFallback(apiPath, staticJsonPath) {
  try {
    const res = await fetch(apiPath, { headers: getAdminHeaders() });
    if (res.ok) return await res.json();
  } catch (e) {}

  try {
    const res = await fetch(staticJsonPath);
    if (res.ok) return await res.json();
  } catch (e) {}

  try {
    const alt = staticJsonPath.startsWith('./') ? `.${staticJsonPath}` : `../${staticJsonPath}`;
    const res = await fetch(alt);
    if (res.ok) return await res.json();
  } catch (e) {}

  // 3차 fallback: 원격 학생용 배포 사이트의 data 폴더에서 직접 연동 (CORS 지원)
  try {
    const filename = staticJsonPath.split('/').pop();
    const liveUrl = `https://woorimseok514.github.io/knumedjokbo/data/${filename}`;
    const resLive = await fetch(liveUrl);
    if (resLive.ok) return await resLive.json();
  } catch (e) {}

  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}



// ------------------- 관리자 문제 및 정답 편집기 (지문, 선지 추가/삭제, 정답 실시간 동기화) -------------------
let adminLoadedExams = [];
let currentEditingAdminExam = null;
let currentEditingAdminExamId = null;
let adminEditingAnswerMap = {};

function cleanQuestionStem(text) {
  if (!text) return '';
  let cleaned = String(text);
  cleaned = cleaned.replace(/\(\s*[1-5](?:\s*,\s*[1-5])*\s*\)([\.\s]*)$/, ' ( ) $1');
  cleaned = cleaned.replace(/([\?\.\)])\s*([1-5](?:\s*,\s*[1-5])*)\s*$/, '$1');
  cleaned = cleaned.replace(/\s+([1-5](?:\s*,\s*[1-5])*)\s*$/, '');
  return cleaned.trim();
}

async function openAdminAnswerKeyModal(examId) {
  currentEditingAdminExamId = examId;
  let exam = (adminLoadedExams || []).find(e => e.id === examId);

  if (!exam) {
    try {
      const all = await fetchJsonWithFallback('/api/exams', './data/exams.json');
      if (Array.isArray(all)) {
        adminLoadedExams = all;
        exam = all.find(e => e.id === examId) || all[0];
      }
    } catch (e) {}
  }

  if (!exam) {
    alert('족보 세트 정보를 불러올 수 없습니다.');
    return;
  }

  // 1. 로컬스토리지에 저장된 커스텀 exam override가 있다면 완전 복원
  const savedExamOverride = localStorage.getItem(`custom_exam_override_${examId}`);
  if (savedExamOverride) {
    try {
      exam = JSON.parse(savedExamOverride);
    } catch (e) {}
  }

  currentEditingAdminExam = JSON.parse(JSON.stringify(exam)); // Deep clone for safe editing

  // 2. 정답표 병합
  const savedLocal = localStorage.getItem(`custom_answer_keys_${examId}`);
  let mergedKeys = { ...(currentEditingAdminExam.answer_keys || {}) };
  if (savedLocal) {
    try {
      mergedKeys = { ...mergedKeys, ...JSON.parse(savedLocal) };
    } catch (e) {}
  }
  adminEditingAnswerMap = { ...mergedKeys };

  (currentEditingAdminExam.questions || []).forEach((q, idx) => {
    const qNum = String(q.q_number || (idx + 1));
    if (!adminEditingAnswerMap[qNum] && q.answer) {
      adminEditingAnswerMap[qNum] = String(q.answer);
    }
  });

  const titleEl = document.getElementById('adminAkModalTitle');
  if (titleEl) {
    titleEl.textContent = `[${currentEditingAdminExam.title || '족보'}] 문제 및 정답 편집기`;
  }

  renderAdminAnswerKeyList();

  const modal = document.getElementById('adminAnswerKeyModal');
  if (modal) modal.classList.remove('hidden');
}

function renderAdminAnswerKeyList() {
  const container = document.getElementById('adminAkQuestionsList');
  if (!container || !currentEditingAdminExam) return;

  const questions = currentEditingAdminExam.questions || [];
  if (questions.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-500 py-8 text-sm">등록된 문항이 없습니다.</div>';
    return;
  }

  const circleSymbols = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

  container.innerHTML = questions.map((q, idx) => {
    const qNum = String(q.q_number || (idx + 1));
    const currentVal = adminEditingAnswerMap[qNum] || '';
    const stem = q.stem || '';
    const choices = q.choices || [];
    const isSubjective = choices.length === 0;

    // 동적 선지 선택 버튼들
    let optButtons = [];
    const count = choices.length > 0 ? choices.length : 5;
    for (let cIdx = 1; cIdx <= count; cIdx++) {
      const optStr = String(cIdx);
      const optCircle = circleSymbols[cIdx - 1] || `(${cIdx})`;
      const isSelected = String(currentVal) === optStr || String(currentVal) === optCircle;
      const activeClass = isSelected
        ? 'bg-indigo-600 text-white font-bold ring-2 ring-indigo-400 shadow-sm'
        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700';
      optButtons.push(`
        <button type="button" onclick="quickSetAdminAnswerKey('${qNum}', '${optCircle}')" 
                class="min-w-[30px] h-7 px-1.5 rounded-lg text-xs font-semibold transition ${activeClass}">
          ${optCircle}
        </button>
      `);
    }

    return `
      <div class="p-5 bg-slate-800/80 rounded-2xl border border-slate-700 space-y-4 hover:border-slate-600 transition shadow-sm">
        <!-- 문항 상단 헤더 -->
        <div class="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">
              Q.${qNum}
            </span>
            <span class="text-xs font-semibold ${isSubjective ? 'text-amber-400' : 'text-indigo-300'}">
              ${isSubjective ? '주관식 / 서술형' : `객관식 (${choices.length}지선다)`}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" onclick="toggleSubjectiveMode('${qNum}')" 
                    class="px-2.5 py-1 text-[11px] rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
              ${isSubjective ? '<i class="fa-solid fa-list-ol mr-1"></i>객관식으로 전환' : '<i class="fa-solid fa-pen mr-1"></i>주관식으로 전환'}
            </button>
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold ${currentVal ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
              ${currentVal ? '정답 ' + escapeHtml(currentVal) : '정답 미지정'}
            </span>
          </div>
        </div>

        <!-- 1. 문제 지문(Stem) 편집 영역 -->
        <div>
          <label class="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1.5">
            <i class="fa-solid fa-pencil text-[10px] text-indigo-400"></i>
            <span>문제 지문 (Stem) 수정:</span>
          </label>
          <textarea onchange="updateAdminQuestionStem('${qNum}', this.value)"
                    placeholder="문제 지문을 입력하세요"
                    rows="3"
                    class="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-medium focus:outline-none focus:border-indigo-500 transition leading-relaxed">${escapeHtml(stem)}</textarea>
        </div>

        <!-- 2. 보기 / 선지(Choices) 편집 영역 -->
        ${!isSubjective ? `
          <div class="space-y-2 pt-1">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                <i class="fa-solid fa-list-check text-[10px] text-indigo-400"></i>
                <span>보기 / 선지 (Choices) 수정:</span>
              </label>
              <button type="button" onclick="addAdminChoice('${qNum}')" 
                      class="px-2.5 py-1 text-[11px] font-bold text-indigo-400 hover:text-indigo-300 hover:bg-slate-700 rounded-lg transition flex items-center gap-1">
                <i class="fa-solid fa-plus text-[10px]"></i>
                <span>선지 추가</span>
              </button>
            </div>
            <div class="space-y-2">
              ${choices.map((c, cIdx) => {
                const label = c.label || circleSymbols[cIdx] || `(${cIdx + 1})`;
                return `
                  <div class="flex items-center gap-2">
                    <span class="w-7 h-7 rounded-lg bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-bold shrink-0">
                      ${label}
                    </span>
                    <input type="text"
                           value="${escapeHtml(c.text || '')}"
                           onchange="updateAdminChoiceText('${qNum}', ${cIdx}, this.value)"
                           placeholder="선지 내용 입력"
                           class="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-medium focus:outline-none focus:border-indigo-500 transition" />
                    <button type="button" 
                            title="선지 삭제"
                            onclick="removeAdminChoice('${qNum}', ${cIdx})" 
                            class="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-700 transition">
                      <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 3. 정답 지정 바 -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-700/60">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-[11px] text-slate-400 font-medium mr-1">정답 원클릭 지정:</span>
            ${!isSubjective ? optButtons.join(' ') : '<span class="text-xs text-slate-400">주관식 문항은 우측 입력창에 정답을 적어주세요</span>'}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-400 font-medium">정답 직접입력:</span>
            <input type="text" 
                   value="${escapeHtml(currentVal)}" 
                   placeholder="예: ③ 또는 3,4"
                   onchange="updateAdminAnswerKeyText('${qNum}', this.value)"
                   class="w-32 px-2.5 py-1 text-xs bg-slate-900 border border-slate-600 rounded-lg text-white font-bold text-center focus:outline-none focus:border-indigo-500 transition" />
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function updateAdminQuestionStem(qNum, newStem) {
  if (!currentEditingAdminExam) return;
  const q = (currentEditingAdminExam.questions || []).find(x => String(x.q_number) === String(qNum));
  if (q) {
    q.stem = newStem.trim();
  }
}

function updateAdminChoiceText(qNum, cIdx, newText) {
  if (!currentEditingAdminExam) return;
  const q = (currentEditingAdminExam.questions || []).find(x => String(x.q_number) === String(qNum));
  if (q && q.choices && q.choices[cIdx]) {
    q.choices[cIdx].text = newText.trim();
  }
}

function addAdminChoice(qNum) {
  if (!currentEditingAdminExam) return;
  const circleSymbols = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const q = (currentEditingAdminExam.questions || []).find(x => String(x.q_number) === String(qNum));
  if (q) {
    if (!q.choices) q.choices = [];
    const nextIdx = q.choices.length;
    q.choices.push({
      label: circleSymbols[nextIdx] || `(${nextIdx + 1})`,
      text: ''
    });
    renderAdminAnswerKeyList();
  }
}

function removeAdminChoice(qNum, cIdx) {
  if (!currentEditingAdminExam) return;
  const circleSymbols = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const q = (currentEditingAdminExam.questions || []).find(x => String(x.q_number) === String(qNum));
  if (q && q.choices) {
    q.choices.splice(cIdx, 1);
    // 재라벨링
    q.choices.forEach((c, idx) => {
      c.label = circleSymbols[idx] || `(${idx + 1})`;
    });
    renderAdminAnswerKeyList();
  }
}

function toggleSubjectiveMode(qNum) {
  if (!currentEditingAdminExam) return;
  const q = (currentEditingAdminExam.questions || []).find(x => String(x.q_number) === String(qNum));
  if (q) {
    if (!q.choices || q.choices.length === 0) {
      // 객관식으로 전환: 5개 기본 생성
      const circleSymbols = ['①', '②', '③', '④', '⑤'];
      q.choices = circleSymbols.map((s, i) => ({ label: s, text: '' }));
    } else {
      // 주관식으로 전환: 선지 비우기
      q.choices = [];
    }
    renderAdminAnswerKeyList();
  }
}

function quickSetAdminAnswerKey(qNum, opt) {
  if (String(adminEditingAnswerMap[qNum]) === String(opt)) {
    delete adminEditingAnswerMap[qNum];
  } else {
    adminEditingAnswerMap[qNum] = String(opt);
  }
  renderAdminAnswerKeyList();
}

function updateAdminAnswerKeyText(qNum, val) {
  const trimmed = val.trim();
  if (trimmed) {
    adminEditingAnswerMap[qNum] = trimmed;
  } else {
    delete adminEditingAnswerMap[qNum];
  }
  renderAdminAnswerKeyList();
}

function closeAdminAnswerKeyModal() {
  const modal = document.getElementById('adminAnswerKeyModal');
  if (modal) modal.classList.add('hidden');
}

async function saveAdminExamEdits() {
  if (!currentEditingAdminExam || !currentEditingAdminExamId) {
    alert('선택된 족보 세트가 없습니다.');
    return;
  }

  // 1. answer_keys 및 q.answer 업데이트
  currentEditingAdminExam.answer_keys = { ...adminEditingAnswerMap };
  if (Array.isArray(currentEditingAdminExam.questions)) {
    currentEditingAdminExam.questions.forEach((q, idx) => {
      const qNum = String(q.q_number || (idx + 1));
      if (adminEditingAnswerMap[qNum]) {
        q.answer = adminEditingAnswerMap[qNum];
      }
    });
  }

  // 2. localStorage에 영구 보존 (같은 도메인의 이용자 포털과 즉시 공유!)
  localStorage.setItem(`custom_exam_override_${currentEditingAdminExamId}`, JSON.stringify(currentEditingAdminExam));
  localStorage.setItem(`custom_answer_keys_${currentEditingAdminExamId}`, JSON.stringify(adminEditingAnswerMap));

  // 3. 전체 adminLoadedExams 캐시 저장
  try {
    const idx = adminLoadedExams.findIndex(e => e.id === currentEditingAdminExamId);
    if (idx !== -1) {
      adminLoadedExams[idx] = currentEditingAdminExam;
    } else {
      adminLoadedExams.push(currentEditingAdminExam);
    }
    localStorage.setItem('cached_exams_json', JSON.stringify(adminLoadedExams));
  } catch (e) {}

  // 4. Supabase DB 연결되어 있을 경우 동기화 시도
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient.from('exam_overrides').upsert({
        exam_id: currentEditingAdminExamId,
        exam_data: currentEditingAdminExam,
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Supabase sync skipped:', e);
    }
  }

  alert(`[${currentEditingAdminExam.title || '족보'}] 문제 지문, 보기 선지 및 정답이 성공적으로 저장되었습니다!\n\n이용자(학생) 포털에서도 즉시 수정된 내용이 반영됩니다.`);

  closeAdminAnswerKeyModal();
  loadSubjects();
}

// 하위 호환성 유지용 alias
const saveAdminAnswerKey = saveAdminExamEdits;

function downloadCleanedExamsJson() {
  if (!adminLoadedExams || adminLoadedExams.length === 0) {
    alert('다운로드할 족보 데이터가 없습니다.');
    return;
  }

  if (currentEditingAdminExam && currentEditingAdminExamId) {
    currentEditingAdminExam.answer_keys = { ...adminEditingAnswerMap };
    if (Array.isArray(currentEditingAdminExam.questions)) {
      currentEditingAdminExam.questions.forEach((q, idx) => {
        const qNum = String(q.q_number || (idx + 1));
        if (adminEditingAnswerMap[qNum]) {
          q.answer = adminEditingAnswerMap[qNum];
        }
      });
    }
    const idx = adminLoadedExams.findIndex(e => e.id === currentEditingAdminExamId);
    if (idx !== -1) adminLoadedExams[idx] = currentEditingAdminExam;
  }

  const jsonStr = JSON.stringify(adminLoadedExams, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'exams.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------- 관리자 자료/족보 삭제 기능 -------------------

async function deleteAdminLecture(docId) {
  if (!confirm('정말로 이 강의 자료를 삭제하시겠습니까?
삭제 시 이용자 포털 및 전체 학생 화면에서도 즉시 제외됩니다.')) return;

  // UI 즉시 반응 (해당 행 즉시 반투명/제거)
  try {
    const btn = window.event ? window.event.target : null;
    const tr = btn ? btn.closest('tr') : null;
    if (tr) tr.style.opacity = '0.3';
  } catch (e) {}

  // 1. Supabase shared_lectures 테이블에서 삭제
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient.from('shared_lectures').delete().eq('id', docId);
    } catch (e) {
      console.warn('Supabase lecture delete warning:', e);
    }

    // 1-2. Supabase exam_overrides에 영구 삭제 플래그 기록 (전체 이용자 클라우드 실시간 동기화)
    try {
      await supabaseClient.from('exam_overrides').upsert({
        exam_id: 'deleted_lec_' + docId,
        subject_id: 'sub_fbdc79d0',
        exam_data: { id: docId, is_deleted: true, type: 'lecture' },
        updated_by: '관리자 삭제',
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Supabase lecture override delete warning:', e);
    }
  }

  // 2. 삭제 목록 로컬스토리지 보존
  let deleted = JSON.parse(localStorage.getItem('deleted_lectures') || '[]');
  if (!deleted.includes(docId)) deleted.push(docId);
  localStorage.setItem('deleted_lectures', JSON.stringify(deleted));

  // 3. 백엔드 API 호출 시도 (로컬 서버 환경, 실패해도 무시)
  try {
    await fetch(/api/lectures/, { method: 'DELETE', headers: getAdminHeaders() });
  } catch (e) {}

  alert('강의 자료가 성공적으로 삭제되었습니다.');
  await loadSubjects();
}

async function deleteAdminExam(examId) {
  if (!confirm('정말로 이 족보 문항 세트를 삭제하시겠습니까?
삭제 시 이용자 포털 및 문제은행에서도 즉시 제외됩니다.')) return;

  // UI 즉시 반응
  try {
    const btn = window.event ? window.event.target : null;
    const tr = btn ? btn.closest('tr') : null;
    if (tr) tr.style.opacity = '0.3';
  } catch (e) {}

  // 1. Supabase shared_exams 테이블에서 삭제
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient.from('shared_exams').delete().eq('id', examId);
    } catch (e) {
      console.warn('Supabase exam delete warning:', e);
    }

    // 1-2. exam_overrides에 영구 삭제 플래그 등록 (전체 이용자 클라우드 실시간 동기화)
    try {
      await supabaseClient.from('exam_overrides').upsert({
        exam_id: examId,
        subject_id: 'sub_fbdc79d0',
        exam_data: { id: examId, is_deleted: true, type: 'exam' },
        updated_by: '관리자 삭제',
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Supabase exam override delete warning:', e);
    }
  }

  // 2. 삭제 목록 로컬스토리지 보존
  let deleted = JSON.parse(localStorage.getItem('deleted_exams') || '[]');
  if (!deleted.includes(examId)) deleted.push(examId);
  localStorage.setItem('deleted_exams', JSON.stringify(deleted));

  // 3. 백엔드 API 호출 시도 (로컬 서버 환경, 실패해도 무시)
  try {
    await fetch(/api/exams/, { method: 'DELETE', headers: getAdminHeaders() });
  } catch (e) {}

  alert('족보 문항 세트가 성공적으로 삭제되었습니다.');
  await loadSubjects();
}
