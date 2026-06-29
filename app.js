const API_BASE_URL = "https://api-stagging-callcenter.bizflycloud.vn"; // adjust to your local/staging if needed
let currentApiKey = localStorage.getItem('api_token') || '';
let queueCache = [];
let soundCache = [];
let dialplanCache = [];
let hotlineCache = [];
let callLogCache = [];
let extensionCache = [];
const DEFAULT_PAGE_SIZE = 10;
const CALL_LOG_PAGE_SIZE = 20;
let currentDialplanPage = 1;
let currentExtensionPage = 1;
let currentQueuePage = 1;
let currentSoundPage = 1;
let currentCallLogPage = 1;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apiKey').value = currentApiKey;
    if (currentApiKey) {
        loadHotlinesConfig();
    }
});

function saveApiKey() {
    currentApiKey = document.getElementById('apiKey').value;
    localStorage.setItem('api_token', currentApiKey);
    showToast("Đã lưu API Key", true);
    loadHotlinesConfig();
}

function switchTab(event, tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');

    if (tabId === 'voiceConfig') loadHotlinesConfig();
    if (tabId === 'extensions') loadExtensions();
    if (tabId === 'queues') loadQueues();
    if (tabId === 'sounds') loadSounds();
    if (tabId === 'callLogs') loadCallLogs();
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function encodeId(value) {
    return encodeURIComponent(String(value || ''));
}

function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(Number(value) * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('vi-VN');
}

function toUnixTimestampFromInput(inputId) {
    const value = document.getElementById(inputId).value;
    if (!value) return '';
    const timestampMs = new Date(value).getTime();
    if (Number.isNaN(timestampMs)) return '';
    return String(Math.floor(timestampMs / 1000));
}

function formatDuration(seconds) {
    const totalSeconds = Number(seconds || 0);
    const minutes = Math.floor(totalSeconds / 60);
    const remainSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainSeconds).padStart(2, '0')}`;
}

function renderPagination(containerId, currentPage, total, pageSize, loadFunctionName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const safeTotal = Number(total || 0);
    const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
    if (safeTotal <= pageSize && currentPage <= 1) {
        container.innerHTML = '';
        return;
    }

    const prevPage = Math.max(1, currentPage - 1);
    const nextPage = Math.min(totalPages, currentPage + 1);
    container.innerHTML = `
        <button type="button" ${currentPage <= 1 ? 'disabled' : ''} onclick="${loadFunctionName}(${prevPage})">Trước</button>
        <span class="page-indicator">Trang ${currentPage} / ${totalPages}</span>
        <button type="button" ${currentPage >= totalPages ? 'disabled' : ''} onclick="${loadFunctionName}(${nextPage})">Sau</button>
    `;
}

function showToast(msg, isSuccess = true) {
    let stack = document.getElementById('toastStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toastStack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }

    const toast = document.createElement('div');
    toast.className = `toast-item ${isSuccess ? 'success' : 'error'}`;
    toast.innerHTML = `
        <span class="toast-icon">${isSuccess ? '✓' : '×'}</span>
        <span>${escapeHtml(msg || '')}</span>
    `;
    stack.appendChild(toast);

    window.setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        toast.style.transition = 'opacity .16s ease, transform .16s ease';
        window.setTimeout(() => toast.remove(), 180);
    }, 3200);
}

function normalizeApiErrorMessage(message, status) {
    const rawMessage = String(message || '').trim();
    const compactMessage = rawMessage
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (status === 401 || status === 403) {
        return 'API key không hợp lệ hoặc không có quyền truy cập';
    }
    if (status === 404) {
        return 'Không tìm thấy API hoặc dữ liệu yêu cầu';
    }
    if (status === 405 || /method not allowed/i.test(rawMessage)) {
        return 'API hiện tại không hỗ trợ phương thức này';
    }
    if (status >= 500) {
        return 'Backend đang lỗi, vui lòng thử lại sau';
    }
    if (!compactMessage) {
        return 'Có lỗi khi gọi API';
    }
    return compactMessage.length > 160
        ? `${compactMessage.slice(0, 157)}...`
        : compactMessage;
}

async function showConfirm({ title, text, confirmText = 'Xóa', icon = 'warning' }) {
    const result = await Swal.fire({
        title,
        text,
        icon,
        width: 380,
        showCancelButton: true,
        confirmButtonText: confirmText,
        cancelButtonText: 'Hủy',
        confirmButtonColor: '#DC2626',
        cancelButtonColor: '#64748B',
        reverseButtons: true,
        customClass: {
            popup: 'app-confirm',
            confirmButton: 'app-confirm-button',
            cancelButton: 'app-cancel-button'
        }
    });
    return result.isConfirmed;
}

async function apiRequest(path, options = {}) {
    if (!currentApiKey) {
        showToast("Vui lòng nhập API Key", false);
        return null;
    }

    // Phục hồi lại header Authorization cũ (không có Bearer)
    // vì API staging cũ có thể cấu hình CORS / Middleware chỉ nhận API_KEY trần
    const headers = {
        'Authorization': currentApiKey
    };

    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
        const contentType = res.headers.get("content-type") || "";
        const json = contentType.includes("application/json")
            ? await res.json()
            : { status: false, message: await res.text() };

        if (!res.ok || json.status === false) {
            throw new Error(normalizeApiErrorMessage(json.message || json.error, res.status));
        }
        return json;
    } catch (e) {
        showToast(normalizeApiErrorMessage(e.message), false);
        return null;
    }
}

// ================= VOICE CONFIG (Hotlines & Dialplan) =================
let selectedDialplanId = null;
let selectedDialplanHotlines = [];

document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('hotlineDropdown');
    if (!dropdown || !dropdown.classList.contains('open')) return;
    if (!dropdown.contains(event.target)) {
        dropdown.classList.remove('open');
    }
});

async function loadHotlinesConfig() {
    await loadDialplanHotlines();
    await loadDialplans();
}

async function loadDialplanHotlines() {
    const res = await apiRequest('/v1/api/hotlines');
    if (!res) return;
    hotlineCache = (res.data || []).map(item => {
        if (typeof item === 'object' && item !== null) {
            return String(item.hotline_number || item.number || '');
        }
        return String(item || '');
    }).filter(item => /^\d+$/.test(item));
    renderHotlineDropdown();
    renderCallLogHotlineOptions();
}

function toggleHotlineDropdown() {
    const dropdown = document.getElementById('hotlineDropdown');
    if (dropdown) dropdown.classList.toggle('open');
}

function renderHotlineDropdown() {
    const menu = document.getElementById('hotlineSelect');
    if (!menu) return;

    if (hotlineCache.length === 0) {
        menu.innerHTML = '<div class="multi-select-option">Không có hotline nào</div>';
        renderSelectedHotlineTags();
        return;
    }

    const selectedSet = new Set(selectedDialplanHotlines.map(String));
    menu.innerHTML = hotlineCache.map(hotline => {
        const checked = selectedSet.has(String(hotline)) ? 'checked' : '';
        return `<label class="multi-select-option">
            <input type="checkbox" value="${escapeHtml(hotline)}" ${checked}
                onchange="toggleDialplanHotline('${encodeId(hotline)}', this.checked)">
            <span>${escapeHtml(hotline)}</span>
        </label>`;
    }).join('');
    renderSelectedHotlineTags();
}

function toggleDialplanHotline(encodedHotline, checked) {
    const hotline = decodeURIComponent(encodedHotline);
    if (checked) {
        if (!selectedDialplanHotlines.includes(hotline)) {
            selectedDialplanHotlines.push(hotline);
        }
    } else {
        selectedDialplanHotlines = selectedDialplanHotlines.filter(item => item !== hotline);
    }
    renderHotlineDropdown();
}

function removeDialplanHotline(encodedHotline) {
    const hotline = decodeURIComponent(encodedHotline);
    selectedDialplanHotlines = selectedDialplanHotlines.filter(item => item !== hotline);
    renderHotlineDropdown();
}

function renderSelectedHotlineTags() {
    const label = document.getElementById('hotlineDropdownLabel');
    const tags = document.getElementById('hotlineSelectedTags');
    if (label) {
        label.textContent = selectedDialplanHotlines.length
            ? `Đã chọn ${selectedDialplanHotlines.length} đầu số`
            : 'Chọn đầu số';
        label.classList.toggle('multi-select-placeholder', selectedDialplanHotlines.length === 0);
    }
    if (!tags) return;
    tags.innerHTML = selectedDialplanHotlines.map(hotline => `
        <span class="selected-tag">
            ${escapeHtml(hotline)}
            <button type="button" title="Bỏ chọn" onclick="removeDialplanHotline('${encodeId(hotline)}')">&times;</button>
        </span>
    `).join('');
}

async function loadDialplans(page = currentDialplanPage) {
    currentDialplanPage = page;
    const params = new URLSearchParams({
        offset: String(page),
        limit: String(DEFAULT_PAGE_SIZE)
    });
    const keyword = (document.getElementById('dialplanSearch')?.value || '').trim();
    if (keyword) params.set('search', keyword);

    const res = await apiRequest(`/v1/api/users/dialplans?${params.toString()}`);
    if (!res) return;
    dialplanCache = res.data || [];
    renderDialplanTable(res.total || 0);
}

function renderDialplanTable(total = dialplanCache.length) {
    const tbody = document.querySelector('#dialplansTable tbody');
    if (!tbody) return;

    document.getElementById('dialplanTotal').textContent = `Danh sách (${total})`;
    tbody.innerHTML = '';
    if (dialplanCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">Chưa có kịch bản</td></tr>';
        renderPagination('dialplanPagination', currentDialplanPage, total, DEFAULT_PAGE_SIZE, 'loadDialplans');
        return;
    }

    dialplanCache.forEach(dialplan => {
        const dialplanId = dialplan.id || '';
        const checked = dialplan.activated ? 'checked' : '';
        tbody.innerHTML += `<tr class="${dialplan.activated ? 'highlight-row' : ''}">
            <td><b>${escapeHtml(dialplan.name || '')}</b></td>
            <td>${escapeHtml(formatTimestamp(dialplan.update_time))}</td>
            <td>
                <label class="switch-control">
                    <span>${dialplan.activated ? 'Kích hoạt' : 'Chưa kích hoạt'}</span>
                    <input type="checkbox" ${checked} onchange="toggleDialplanStatus('${encodeId(dialplanId)}', this.checked)">
                    <span class="switch-slider"></span>
                </label>
            </td>
            <td>
                <div class="row-actions">
                    <button class="button-sm primary" onclick="editDialplan('${encodeId(dialplanId)}')">Sửa</button>
                    <button class="button-sm danger" onclick="deleteDialplan('${encodeId(dialplanId)}')">Xóa</button>
                </div>
            </td>
        </tr>`;
    });
    renderPagination('dialplanPagination', currentDialplanPage, total, DEFAULT_PAGE_SIZE, 'loadDialplans');
}

function openDialplanModal(dialplan = null) {
    selectedDialplanId = dialplan?.id || null;
    if (hotlineCache.length === 0) {
        loadDialplanHotlines().then(() => fillDialplanForm(dialplan || {
            name: '',
            note: '',
            dialplan_type: 'inbound',
            list_hotline_call_in_selected: [],
            raw_dialplan: ''
        }));
    }
    fillDialplanForm(dialplan || {
        name: '',
        note: '',
        dialplan_type: 'inbound',
        list_hotline_call_in_selected: [],
        raw_dialplan: ''
    });
    document.getElementById('dialplanModalTitle').textContent = dialplan?.id ? 'Cập nhật kịch bản cuộc gọi' : 'Thêm kịch bản cuộc gọi mới';
    openModal('dialplanModal');
}

function createNewDialplan() {
    openDialplanModal();
}

function fillDialplanForm(dialplan) {
    document.getElementById('dialplanId').value = dialplan.id || '';
    document.getElementById('dialplanName').value = dialplan.name || '';
    document.getElementById('dialplanNote').value = dialplan.note || '';
    document.getElementById('rawDialplan').value = dialplan.raw_dialplan || '';

    selectedDialplanHotlines = (dialplan.list_hotline_call_in_selected || []).map(String);
    renderHotlineDropdown();
}

async function editDialplan(encodedId) {
    const dialplanId = decodeURIComponent(encodedId);
    const res = await apiRequest(`/v1/api/users/dialplans/${dialplanId}`);
    if (!res) return;
    openDialplanModal(res.data || res);
}

function getSelectedHotlines() {
    return selectedDialplanHotlines.filter(Boolean);
}

async function saveDialplan() {
    selectedDialplanId = document.getElementById('dialplanId').value || selectedDialplanId;
    const name = document.getElementById('dialplanName').value.trim();
    const payload = {
        name,
        note: document.getElementById('dialplanNote').value,
        dialplan_type: 'inbound',
        list_hotline_call_in_selected: getSelectedHotlines(),
        raw_dialplan: document.getElementById('rawDialplan').value
    };

    if (!payload.name) return showToast("Vui lòng nhập tên kịch bản", false);
    if (!payload.raw_dialplan) return showToast("Vui lòng nhập raw dialplan", false);

    const path = selectedDialplanId ? `/v1/api/users/dialplans/${selectedDialplanId}` : '/v1/api/users/dialplans';
    const method = selectedDialplanId ? 'PATCH' : 'POST';
    const res = await apiRequest(path, { method, body: JSON.stringify(payload) });

    if (res) {
        showToast(res.message || "Lưu kịch bản thành công", true);
        if (res.id) selectedDialplanId = res.id;
        closeModal('dialplanModal');
        await loadDialplans();
    }
}

async function activateDialplan(dialplanId = selectedDialplanId) {
    if (!dialplanId) return showToast("Vui lòng chọn kịch bản", false);
    const res = await apiRequest(`/v1/api/users/dialplans/${dialplanId}/activate`, { method: 'POST', body: JSON.stringify({}) });
    if (res) {
        showToast(res.message || "Activate kịch bản thành công", true);
        loadDialplans();
    }
}

async function deactivateDialplan(dialplanId = selectedDialplanId) {
    if (!dialplanId) return showToast("Vui lòng chọn kịch bản", false);
    const res = await apiRequest(`/v1/api/users/dialplans/${dialplanId}/deactivate`, { method: 'POST', body: JSON.stringify({}) });
    if (res) {
        showToast(res.message || "Deactivate kịch bản thành công", true);
        loadDialplans();
    }
}

async function toggleDialplanStatus(encodedId, shouldActivate) {
    const dialplanId = decodeURIComponent(encodedId);
    if (shouldActivate) {
        await activateDialplan(dialplanId);
    } else {
        await deactivateDialplan(dialplanId);
    }
}

async function deleteDialplan(encodedId = '') {
    const dialplanId = encodedId ? decodeURIComponent(encodedId) : selectedDialplanId;
    if (!dialplanId) return showToast("Vui lòng chọn kịch bản", false);
    const confirmed = await showConfirm({
        title: 'Xóa kịch bản?',
        text: 'Kịch bản đang active sẽ không thể xóa.'
    });
    if (!confirmed) return;

    const res = await apiRequest(`/v1/api/users/dialplans/${dialplanId}`, { method: 'DELETE' });
    if (res) {
        showToast(res.message || "Xóa kịch bản thành công", true);
        if (selectedDialplanId === dialplanId) selectedDialplanId = null;
        loadDialplans();
    }
}

// ================= EXTENSIONS =================
async function loadExtensions(page = currentExtensionPage) {
    const listView = document.getElementById('extensionListView');
    const createView = document.getElementById('extensionCreateView');
    if (listView) listView.style.display = '';
    if (createView) createView.style.display = 'none';
    currentExtensionPage = page;

    if (hotlineCache.length === 0) {
        await loadDialplanHotlines();
    }

    const res = await apiRequest('/v1/api/extensions');
    if (!res) return;
    extensionCache = res.extensions || (res.data || []).map(number => ({
        extension_number: String(number || '')
    }));
    renderExtensionsTable();
}

function renderExtensionsTable(page = currentExtensionPage) {
    currentExtensionPage = page;
    const totalEl = document.getElementById('extensionTotal');
    const tbody = document.querySelector('#extensionsTable tbody');
    if (!tbody) return;

    const keyword = (document.getElementById('extensionSearch')?.value || '').trim().toLowerCase();
    const filtered = extensionCache.filter(ext => {
        const extNum = String(ext.extension_number || ext || '').toLowerCase();
        return extNum.includes(keyword);
    });

    const total = filtered.length;
    if (totalEl) totalEl.textContent = `Danh sách máy lẻ (${total})`;

    tbody.innerHTML = '';
    if (total === 0) {
        tbody.innerHTML = '<tr><td class="crm-empty" colspan="2">Không có dữ liệu</td></tr>';
        renderPagination('extensionPagination', currentExtensionPage, total, DEFAULT_PAGE_SIZE, 'renderExtensionsTable');
        return;
    }

    const start = (currentExtensionPage - 1) * DEFAULT_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + DEFAULT_PAGE_SIZE);
    pageItems.forEach(extension => {
        const extensionNumber = extension.extension_number || extension;
        const extensionId = extension.id || extensionNumber;
        tbody.innerHTML += `<tr>
            <td><b>${escapeHtml(extensionNumber)}</b></td>
            <td>
                <div class="actions" style="justify-content: flex-start; gap: 8px;">
                    <button class="button button-secondary" onclick="openExtensionEditView('${extensionId}')">Sửa</button>
                    <button class="button button-danger" onclick="deleteExtension('${extensionId}')">Xóa</button>
                </div>
            </td>
        </tr>`;
    });
    renderPagination('extensionPagination', currentExtensionPage, total, DEFAULT_PAGE_SIZE, 'renderExtensionsTable');
}

async function openExtensionCreateView() {
    const listView = document.getElementById('extensionListView');
    const createView = document.getElementById('extensionCreateView');
    if (hotlineCache.length === 0) {
        await loadDialplanHotlines();
    }
    document.getElementById('extensionNumberInput').value = '';
    if (listView) listView.style.display = 'none';
    if (createView) createView.style.display = '';
    document.getElementById('extensionNumberInput').focus();
}

async function saveExtension() {
    const extensionNumber = document.getElementById('extensionNumberInput').value.trim();
    if (!extensionNumber) return showToast('Vui lòng nhập số máy lẻ', false);
    if (!/^\d+$/.test(extensionNumber)) return showToast('Số máy lẻ chỉ gồm chữ số', false);

    if (hotlineCache.length === 0) {
        await loadDialplanHotlines();
    }
    const hotlineNumber = hotlineCache[0];
    if (!hotlineNumber) return showToast('Không tìm thấy hotline để đăng ký máy lẻ', false);

    const payload = {
        extension_number: extensionNumber,
        hotline_number: hotlineNumber,
        hotline_default: hotlineNumber,
        extension_call_permit: {
            internal: true,
            inbound: true,
            outbound: true,
            mobile: true,
            phone: true,
            internation: true
        }
    };

    const res = await apiRequest('/v1/api/extensions', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (res) {
        showToast(res.message || 'Đăng ký máy lẻ thành công', true);
        await loadExtensions();
    }
}

async function deleteExtension(extensionId) {
    if (!confirm('Bạn có chắc chắn muốn xóa máy lẻ này không?')) return;
    const res = await apiRequest(`/v1/api/extensions/${extensionId}`, { method: 'DELETE' });
    if (res) {
        showToast('Xóa máy lẻ thành công', true);
        await loadExtensions();
    }
}

async function openExtensionEditView(extensionId) {
    const res = await apiRequest(`/v1/api/extensions/${extensionId}`);
    if (!res) return;
    
    document.getElementById('editExtensionId').value = extensionId;
    document.getElementById('editExtensionPassword').value = res.extension_password || '';
    document.getElementById('editExtensionMonitor').value = res.extension_monitor || '';
    
    const permit = res.extension_call_permit || {};
    document.getElementById('permit_internal').checked = !!permit.internal;
    document.getElementById('permit_inbound').checked = !!permit.inbound;
    document.getElementById('permit_outbound').checked = !!permit.outbound;
    document.getElementById('permit_mobile').checked = !!permit.mobile;
    document.getElementById('permit_phone').checked = !!permit.phone;
    document.getElementById('permit_internation').checked = !!permit.internation;

    openModal('extensionEditModal');
}

async function updateExtension() {
    const extensionId = document.getElementById('editExtensionId').value;
    const password = document.getElementById('editExtensionPassword').value;
    const monitor = document.getElementById('editExtensionMonitor').value;
    
    const permit = {
        internal: document.getElementById('permit_internal').checked,
        inbound: document.getElementById('permit_inbound').checked,
        outbound: document.getElementById('permit_outbound').checked,
        mobile: document.getElementById('permit_mobile').checked,
        phone: document.getElementById('permit_phone').checked,
        internation: document.getElementById('permit_internation').checked
    };

    const payload = {
        extension_call_permit: permit
    };
    
    if (password) {
        payload.extension_password = password;
    }
    if (monitor) {
        payload.extension_monitor = monitor;
    }

    const res = await apiRequest(`/v1/api/extensions/${extensionId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
    
    if (res) {
        showToast('Cập nhật máy lẻ thành công', true);
        closeModal('extensionEditModal');
        await loadExtensions();
    }
}

// ================= QUEUES =================
let queueSelectedMembers = [];
let selectedQueueMember = '';
let selectedAvailableExtension = '';

async function loadQueues(page = currentQueuePage) {
    showQueueListView();
    currentQueuePage = page;
    const params = new URLSearchParams({
        offset: String(page),
        limit: String(DEFAULT_PAGE_SIZE)
    });
    
    const keyword = (document.getElementById('queueSearch')?.value || '').trim();
    if (keyword) params.set('search', keyword);
    
    const res = await apiRequest(`/v1/api/users/queues?${params.toString()}`);
    if (!res) return;
    queueCache = res.data || [];
    renderQueueTable(res.total || 0);
}

function showQueueListView() {
    const listView = document.getElementById('queueListView');
    const formView = document.getElementById('queueFormView');
    if (listView) listView.style.display = '';
    if (formView) formView.style.display = 'none';
}

function showQueueFormView() {
    const listView = document.getElementById('queueListView');
    const formView = document.getElementById('queueFormView');
    if (listView) listView.style.display = 'none';
    if (formView) formView.style.display = '';
}

function renderQueueTable(total = queueCache.length) {
    const tbody = document.querySelector('#queuesTable tbody');
    const totalEl = document.getElementById('queueTotal');
    if (!tbody) return;
    if (totalEl) totalEl.textContent = `Danh sách nhóm máy lẻ (${total})`;

    tbody.innerHTML = '';
    if (queueCache.length === 0) {
        tbody.innerHTML = '<tr><td class="crm-empty" colspan="3">Không có dữ liệu</td></tr>';
        renderPagination('queuePagination', currentQueuePage, total, DEFAULT_PAGE_SIZE, 'loadQueues');
        return;
    }

    queueCache.forEach(q => {
        const queueId = q.id || '';
        const members = Array.isArray(q.member_list) ? q.member_list : [];
        tbody.innerHTML += `<tr>
            <td><b style="color:#5b56e9;">${escapeHtml(q.queue_name || q.name || '')}</b></td>
            <td><b style="color:#5b56e9;">${members.length}</b></td>
            <td>
                <div class="row-actions">
                    <button class="button-sm primary" onclick="editQueue('${encodeId(queueId)}')">Sửa</button>
                    <button class="button-sm danger" onclick="deleteQueue('${encodeId(queueId)}')">Xóa</button>
                </div>
            </td>
        </tr>`;
    });
    renderPagination('queuePagination', currentQueuePage, total, DEFAULT_PAGE_SIZE, 'loadQueues');
}

async function fetchExtensionsForQueueForm() {
    if (extensionCache.length > 0) return;
    const res = await apiRequest('/v1/api/extensions');
    if (!res) return;
    extensionCache = res.extensions || (res.data || []).map(number => ({
        extension_number: String(number || '')
    }));
}

function getExtensionNumbers() {
    return extensionCache
        .map(extension => String(extension.extension_number || extension || '').trim())
        .filter(Boolean);
}

async function openQueueForm(queue = null) {
    await fetchExtensionsForQueueForm();
    document.getElementById('q_id').value = queue?.id || '';
    document.getElementById('q_name').value = queue?.queue_name || queue?.name || '';
    document.getElementById('q_strategy').value = queue?.strategy || 'all';
    document.getElementById('queueFormTitle').textContent = queue?.id ? 'Sửa nhóm máy lẻ' : 'Thêm nhóm máy lẻ';
    queueSelectedMembers = Array.isArray(queue?.member_list)
        ? queue.member_list.map(String)
        : [];
    selectedQueueMember = '';
    selectedAvailableExtension = '';
    renderQueueMemberLists();
    showQueueFormView();
}

function closeQueueForm() {
    showQueueListView();
}

function renderQueueMemberLists() {
    const selectedList = document.getElementById('queueSelectedMembers');
    const availableList = document.getElementById('queueAvailableMembers');
    if (!selectedList || !availableList) return;

    const selectedSet = new Set(queueSelectedMembers.map(String));
    const availableMembers = getExtensionNumbers().filter(number => !selectedSet.has(number));

    selectedList.innerHTML = queueSelectedMembers.map(number => `
        <li class="group-member-item ${selectedQueueMember === number ? 'selected' : ''}"
            onclick="selectQueueMember('${encodeId(number)}')">${escapeHtml(number)}</li>
    `).join('');

    availableList.innerHTML = availableMembers.map(number => `
        <li class="group-member-item ${selectedAvailableExtension === number ? 'selected' : ''}"
            onclick="selectAvailableExtension('${encodeId(number)}')">${escapeHtml(number)}</li>
    `).join('');
}

function selectQueueMember(encodedNumber) {
    selectedQueueMember = decodeURIComponent(encodedNumber);
    selectedAvailableExtension = '';
    renderQueueMemberLists();
}

function selectAvailableExtension(encodedNumber) {
    selectedAvailableExtension = decodeURIComponent(encodedNumber);
    selectedQueueMember = '';
    renderQueueMemberLists();
}

function addSelectedExtensionToQueue() {
    if (!selectedAvailableExtension) return;
    if (!queueSelectedMembers.includes(selectedAvailableExtension)) {
        queueSelectedMembers.push(selectedAvailableExtension);
    }
    selectedAvailableExtension = '';
    renderQueueMemberLists();
}

function removeSelectedExtensionFromQueue() {
    if (!selectedQueueMember) return;
    queueSelectedMembers = queueSelectedMembers.filter(number => number !== selectedQueueMember);
    selectedQueueMember = '';
    renderQueueMemberLists();
}

async function editQueue(encodedId) {
    const queueId = decodeURIComponent(encodedId);
    const res = await apiRequest(`/v1/api/users/queues/${queueId}`);
    if (!res) return;
    openQueueForm(res.data || res);
}

async function saveQueue() {
    const queueId = document.getElementById('q_id').value;
    const queueName = document.getElementById('q_name').value.trim();
    if (!queueName) return showToast('Vui lòng nhập tên nhóm', false);
    if (queueSelectedMembers.length === 0) return showToast('Vui lòng chọn máy lẻ trong nhóm', false);

    const payload = {
        queue_name: queueName,
        member_list: queueSelectedMembers,
        note: '',
        strategy: document.getElementById('q_strategy').value,
        member_timeout: 25,
        status: 'active'
    };

    const path = queueId ? `/v1/api/users/queues/${queueId}` : '/v1/api/users/queues';
    const method = queueId ? 'PATCH' : 'POST';
    const res = await apiRequest(path, { method, body: JSON.stringify(payload) });
    if (res) {
        showToast(res.message || 'Lưu nhóm máy lẻ thành công');
        loadQueues();
    }
}

async function deleteQueue(encodedId) {
    const queueId = decodeURIComponent(encodedId);
    const confirmed = await showConfirm({
        title: 'Xóa nhóm máy lẻ?',
        text: 'Nhóm đang gắn với kịch bản sẽ không thể xóa.'
    });
    if (!confirmed) return;

    const res = await apiRequest(`/v1/api/users/queues/${queueId}`, { method: 'DELETE' });
    if (res) { showToast(res.message); loadQueues(); }
}

// ================= SOUNDS =================

async function loadSounds(page = currentSoundPage) {
    currentSoundPage = page;
    const params = new URLSearchParams({
        offset: String(page),
        limit: String(DEFAULT_PAGE_SIZE)
    });
    const keyword = (document.getElementById('soundSearch')?.value || '').trim();
    if (keyword) params.set('search', keyword);

    const res = await apiRequest(`/v1/api/users/sounds?${params.toString()}`);
    if (!res) return;
    soundCache = res.data || [];
    const tbody = document.querySelector('#soundsTable tbody');
    tbody.innerHTML = '';
    if (soundCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Chưa có file ghi âm</td></tr>';
        renderPagination('soundPagination', currentSoundPage, res.total || 0, DEFAULT_PAGE_SIZE, 'loadSounds');
        return;
    }

    soundCache.forEach((s, i) => {
        const audioId = `audio_${s.id || i}`;
        const soundId = s.id || '';
        tbody.innerHTML += `<tr>
            <td><code>${escapeHtml(soundId)}</code></td>
            <td>${escapeHtml(s.sound_name || '')}</td>
            <td>${escapeHtml(s.commit || '')}</td>
            <td>
                <audio id="${audioId}" controls style="height: 40px; width: 250px;" preload="none"></audio>
            </td>
            <td>
                <div class="row-actions">

                    <button class="button-sm primary" onclick="editSound('${encodeId(soundId)}')">Sửa</button>
                    <button class="button-sm danger" onclick="deleteSound('${encodeId(soundId)}')">Xóa</button>
                </div>
            </td>
        </tr>`;
    });

    soundCache.forEach((s, i) => {
        const audioId = `audio_${s.id || i}`;
        const audioEl = document.getElementById(audioId);
        if (audioEl) {
            if (s.url_storage) {
                audioEl.src = s.url_storage;
                audioEl.preload = "none";
            }
        }
    });
    renderPagination('soundPagination', currentSoundPage, res.total || 0, DEFAULT_PAGE_SIZE, 'loadSounds');
}

function resetSoundSearch() {
    const input = document.getElementById('soundSearch');
    if (input) input.value = '';
    loadSounds(1);
}

function openSoundModal(sound = null) {
    document.getElementById('s_id').value = sound?.id || '';
    document.getElementById('s_name').value = sound?.sound_name || '';
    document.getElementById('s_commit').value = sound?.commit || '';
    document.getElementById('s_file').value = '';
    document.getElementById('soundModalTitle').textContent = sound?.id ? 'Cập nhật Âm thanh' : 'Upload Âm thanh';
    document.getElementById('soundSubmitBtn').textContent = sound?.id ? 'Cập nhật' : 'Upload';
    openModal('soundModal');
}

async function editSound(encodedId) {
    const soundId = decodeURIComponent(encodedId);
    const res = await apiRequest(`/v1/api/users/sounds/${soundId}`);
    if (!res) return;
    openSoundModal(res.data || res);
}

async function saveSound() {
    const soundId = document.getElementById('s_id').value;
    const file = document.getElementById('s_file').files[0];
    const name = document.getElementById('s_name').value;
    const commit = document.getElementById('s_commit').value;
    if (!name) return showToast("Vui lòng nhập tên âm thanh", false);
    if (!soundId && !file) return showToast("Vui lòng chọn file", false);

    const formData = new FormData();
    if (file) {
        formData.append('file', file);
    }
    formData.append('sound_name', name);
    if (commit) {
        formData.append('commit', commit);
    }

    const path = soundId ? `/v1/api/users/sounds/${soundId}` : '/v1/api/users/sounds';
    const method = soundId ? 'PATCH' : 'POST';
    const res = await apiRequest(path, { method, body: formData });
    if (res) { showToast(res.message); closeModal('soundModal'); loadSounds(); }
}

async function deleteSound(encodedId) {
    const soundId = decodeURIComponent(encodedId);
    const confirmed = await showConfirm({
        title: 'Xóa file ghi âm?',
        text: 'Thao tác này sẽ xóa bản ghi file khỏi danh sách.'
    });
    if (!confirmed) return;

    const res = await apiRequest(`/v1/api/users/sounds/${soundId}`, { method: 'DELETE' });
    if (res) { showToast(res.message); loadSounds(); }
}

// ================= CALL LOGS =================
function renderCallLogHotlineOptions() {
    const select = document.getElementById('logHotline');
    if (!select) return;
    const selectedValue = select.value;
    select.innerHTML = '<option value="">Tất cả hotline</option>';
    hotlineCache.forEach(hotline => {
        select.innerHTML += `<option value="${escapeHtml(hotline)}">${escapeHtml(hotline)}</option>`;
    });
    select.value = selectedValue;
}

async function ensureCallLogHotlines() {
    if (hotlineCache.length > 0) {
        renderCallLogHotlineOptions();
        return;
    }
    await loadDialplanHotlines();
}

function buildCallLogQuery(page = 1) {
    const params = new URLSearchParams();
    const hotline = document.getElementById('logHotline').value;
    const state = document.getElementById('logState').value;
    const direct = document.getElementById('logDirect').value;
    const keyword = document.getElementById('logKeyword').value.trim();
    const fromTime = toUnixTimestampFromInput('logFromTime');
    const toTime = toUnixTimestampFromInput('logToTime');

    params.set('offset', String(page));
    params.set('limit', String(CALL_LOG_PAGE_SIZE));
    if (hotline) params.set('hotline_number', hotline);
    if (state) params.set('state', state);
    if (direct) params.set('direct', direct);
    if (keyword) params.set('keyword', keyword);
    if (fromTime) params.set('from_time', fromTime);
    if (toTime) params.set('to_time', toTime);
    return params.toString();
}

async function loadCallLogs(page = currentCallLogPage) {
    await ensureCallLogHotlines();
    currentCallLogPage = page;
    const res = await apiRequest(`/v1/api/reports?${buildCallLogQuery(page)}`);
    if (!res) return;
    callLogCache = res.data || [];
    const total = res.total || 0;
    document.getElementById('callLogTotal').textContent = `Tổng: ${total}`;

    const tbody = document.querySelector('#callLogsTable tbody');
    tbody.innerHTML = '';
    if (callLogCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8">Không có call log</td></tr>';
        renderPagination('callLogPagination', currentCallLogPage, total, CALL_LOG_PAGE_SIZE, 'loadCallLogs');
        return;
    }

    callLogCache.forEach((log, index) => {
        const stateClass = String(log.state || '').toLowerCase();
        const audioCell = log.audio_url
            ? `<audio controls src="${escapeHtml(log.audio_url)}" style="height: 36px; width: 220px;" preload="none"></audio>`
            : '';
        tbody.innerHTML += `<tr onclick="showCallLogDetail(${index})" style="cursor:pointer;">
            <td>${escapeHtml(formatTimestamp(log.start_time))}</td>
            <td>${escapeHtml(log.hotline_number || '')}</td>
            <td>${escapeHtml(log.caller || '')}</td>
            <td>${escapeHtml(log.callee || '')}</td>
            <td>${escapeHtml(log.direct || '')}</td>
            <td><span class="state-pill ${escapeHtml(stateClass)}">${escapeHtml(log.state || '')}</span></td>
            <td>${escapeHtml(formatDuration(log.conversation_duration || log.duration || log.call_time))}</td>
            <td>${audioCell}</td>
        </tr>`;
    });
    renderPagination('callLogPagination', currentCallLogPage, total, CALL_LOG_PAGE_SIZE, 'loadCallLogs');
}

function showCallLogDetail(index) {
    const log = callLogCache[index];
    if (!log) return showToast("Không tìm thấy call log", false);
    document.getElementById('callLogDetail').textContent = JSON.stringify(log, null, 2);
    openModal('callLogModal');
}

async function fetchCallLogDetail(encodedId) {
    const callId = decodeURIComponent(encodedId);
    if (!callId) return showToast("Call ID không hợp lệ", false);
    const res = await apiRequest(`/v1/api/reports/${callId}`);
    if (!res) return;
    document.getElementById('callLogDetail').textContent = JSON.stringify(res.data || res, null, 2);
    openModal('callLogModal');
}

function resetCallLogFilters() {
    document.getElementById('logHotline').value = '';
    document.getElementById('logState').value = '';
    document.getElementById('logDirect').value = '';
    document.getElementById('logKeyword').value = '';
    document.getElementById('logFromTime').value = '';
    document.getElementById('logToTime').value = '';
    loadCallLogs(1);
}
