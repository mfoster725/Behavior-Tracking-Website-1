// ==================== MARKETPLACE TAB ====================

var currentMarketplaceStudentId = null;
var marketplaceCatalog = [];
var marketplaceCart = []; // [{ item_id, quantity, name?, price? }]
var marketplaceBalance = null;

function getMarketplaceCartKey() {
    var uid = (window.currentUser && window.currentUser.id) ? window.currentUser.id : 'anon';
    return 'marketplace_cart_' + uid;
}

function getMarketplaceStudentId() {
    if (window.currentUser && window.currentUser.role === 'student') {
        return window.currentUser.studentId || null;
    }
    return currentMarketplaceStudentId;
}

function loadMarketplaceCartFromStorage() {
    try {
        var raw = sessionStorage.getItem(getMarketplaceCartKey());
        marketplaceCart = raw ? JSON.parse(raw) : [];
    } catch (e) {
        marketplaceCart = [];
    }
}

function saveMarketplaceCartToStorage() {
    try {
        sessionStorage.setItem(getMarketplaceCartKey(), JSON.stringify(marketplaceCart));
    } catch (e) {}
}

function addToMarketplaceCart(itemId, name, price, quantity) {
    quantity = quantity || 1;
    var existing = marketplaceCart.find(function (x) { return x.item_id === itemId; });
    if (existing) {
        existing.quantity += quantity;
    } else {
        marketplaceCart.push({ item_id: itemId, quantity: quantity, name: name, price: price });
    }
    saveMarketplaceCartToStorage();
    renderMarketplaceCart();
}

function removeFromMarketplaceCart(itemId) {
    marketplaceCart = marketplaceCart.filter(function (x) { return x.item_id !== itemId; });
    saveMarketplaceCartToStorage();
    renderMarketplaceCart();
}

function setMarketplaceCartQuantity(itemId, quantity) {
    var item = marketplaceCart.find(function (x) { return x.item_id === itemId; });
    if (!item) return;
    if (quantity <= 0) {
        removeFromMarketplaceCart(itemId);
        return;
    }
    item.quantity = quantity;
    saveMarketplaceCartToStorage();
    renderMarketplaceCart();
}

function renderMarketplaceCart() {
    var el = document.getElementById('marketplace-cart-items');
    var totalEl = document.getElementById('marketplace-cart-total');
    var checkoutBtn = document.getElementById('marketplace-checkout-btn');
    if (!el) return;
    if (!marketplaceCart.length) {
        el.innerHTML = '<p style="margin:0; color:#94a3b8; font-size:13px;">Cart is empty.</p>';
        if (totalEl) totalEl.textContent = 'Total: $0.00';
        if (checkoutBtn) checkoutBtn.disabled = true;
        return;
    }
    var total = 0;
    el.innerHTML = marketplaceCart.map(function (line) {
        var price = Number(line.price || 0);
        var subtotal = price * (line.quantity || 1);
        total += subtotal;
        var itemId = line.item_id;
        return '<div class="marketplace-cart-line" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:13px; gap:8px;">' +
            '<span style="flex:1; min-width:0;">' + (line.name || 'Item') + ' × ' + (line.quantity || 1) + '</span>' +
            '<span>$' + subtotal.toFixed(2) + '</span>' +
            '<button type="button" class="marketplace-cart-remove-btn" data-item-id="' + itemId + '" title="Remove from cart" style="flex-shrink:0; padding:2px 6px; font-size:12px; color:#64748b; background:var(--bg-elevated); border:none; border-radius:var(--radius-sm); cursor:pointer;">✕</button>' +
            '</div>';
    }).join('');
    el.querySelectorAll('.marketplace-cart-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = parseInt(btn.getAttribute('data-item-id'), 10);
            removeFromMarketplaceCart(id);
        });
    });
    if (totalEl) totalEl.textContent = 'Total: $' + total.toFixed(2);
    var checkoutMsg = document.getElementById('marketplace-checkout-msg');
    if (marketplaceBalance !== null && total > marketplaceBalance) {
        if (checkoutBtn) checkoutBtn.disabled = true;
        if (checkoutMsg) { checkoutMsg.style.display = 'block'; checkoutMsg.textContent = 'Insufficient funds.'; checkoutMsg.style.color = '#dc2626'; }
    } else {
        if (checkoutBtn) checkoutBtn.disabled = false;
        if (checkoutMsg) checkoutMsg.style.display = 'none';
    }
}

function handleMarketplaceView() {
    loadMarketplaceCartFromStorage();
    var isStudent = window.currentUser && window.currentUser.role === 'student';
    var poSection = document.getElementById('marketplace-po-approvals-section');
    var viewAsRow = document.getElementById('marketplace-view-as-student-row');
    var studentWrap = document.getElementById('marketplace-student-select-wrap');
    var viewAsCheck = document.getElementById('marketplace-show-view-as-student-checkbox');
    var cartSection = document.getElementById('marketplace-cart-section');
    var balanceSection = document.getElementById('marketplace-balance-section');
    if (poSection) poSection.style.display = (isStudent ? 'none' : 'block');
    if (viewAsRow) viewAsRow.style.display = (isStudent ? 'none' : 'block');
    if (viewAsCheck) viewAsCheck.checked = false;
    if (studentWrap) studentWrap.style.display = 'none';
    if (cartSection) cartSection.style.display = (isStudent ? 'block' : 'none');
    // Balance card: only show for students, or for staff/admin when "View as student" is checked
    if (balanceSection) balanceSection.style.display = (isStudent ? 'block' : 'none');

    if (isStudent) {
        currentMarketplaceStudentId = window.currentUser.studentId || null;
        loadMarketplaceTypesAndCategories();
        loadMarketplaceBalance();
        loadMarketplaceCatalog();
        loadMarketplaceMyOrders();
        renderMarketplaceCart();
        bindMarketplaceCheckout();
    } else {
        loadMarketplacePOApprovals();
        setupMarketplaceStudentSearch();
        loadMarketplaceAnalytics();
        // Staff/admin: default to "Hide analytics" checked so analytics are collapsed
        var analyticsHideCheck = document.getElementById('marketplace-analytics-hide-checkbox');
        var analyticsBody = document.getElementById('marketplace-analytics-body');
        if (analyticsHideCheck && analyticsBody) {
            analyticsHideCheck.checked = true;
            analyticsBody.style.display = 'none';
        }
        loadMarketplaceTypesAndCategories();
        currentMarketplaceStudentId = null;
        document.getElementById('marketplace-balance-amount').textContent = '$0.00';
        document.getElementById('marketplace-student-name').textContent = '';
        loadMarketplaceCatalog(); // staff sees all items (no student required)
        renderMarketplaceCart();
        if (document.getElementById('marketplace-no-items-msg')) document.getElementById('marketplace-no-items-msg').style.display = 'none';
    }
    loadNotifications();
}

function loadMarketplaceBalance() {
    var sid = getMarketplaceStudentId();
    if (!sid) {
        marketplaceBalance = null;
        document.getElementById('marketplace-balance-amount').textContent = '$0.00';
        document.getElementById('marketplace-student-name').textContent = '';
        renderMarketplaceCart();
        return;
    }
    fetch('/api/bank-account/' + sid)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
            marketplaceBalance = Number(data.balance) || 0;
            document.getElementById('marketplace-balance-amount').textContent = '$' + marketplaceBalance.toFixed(2);
            var student = (typeof allStudents !== 'undefined' && allStudents) ? allStudents.find(function (s) { return s.id === sid; }) : null;
            document.getElementById('marketplace-student-name').textContent = student ? student.name : '';
            renderMarketplaceCart();
        })
        .catch(function () {
            marketplaceBalance = null;
            document.getElementById('marketplace-balance-amount').textContent = '$0.00';
            document.getElementById('marketplace-student-name').textContent = '';
            renderMarketplaceCart();
        });
}

function loadMarketplaceCatalog() {
    var isStudent = window.currentUser && window.currentUser.role === 'student';
    var sid = getMarketplaceStudentId();
    var params = new URLSearchParams();
    if (isStudent) {
        if (!sid) {
            document.getElementById('marketplace-items-grid').innerHTML = '';
            document.getElementById('marketplace-no-items-msg').style.display = 'block';
            return;
        }
        params.set('student_id', sid);
    } else {
        // Staff/admin: load all items with hidden_rules (no student required)
        params.set('staff', '1');
    }
    var q = document.getElementById('marketplace-search-input') && document.getElementById('marketplace-search-input').value.trim();
    var typeId = document.getElementById('marketplace-filter-type') && document.getElementById('marketplace-filter-type').value;
    var categoryId = document.getElementById('marketplace-filter-category') && document.getElementById('marketplace-filter-category').value;
    if (q) params.set('q', q);
    if (typeId) params.set('type_id', typeId);
    if (categoryId) params.set('category_id', categoryId);
    fetch('/api/marketplace/catalog?' + params.toString())
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (items) {
            marketplaceCatalog = items;
            renderMarketplaceCatalog(items);
            var noMsg = document.getElementById('marketplace-no-items-msg');
            if (noMsg) noMsg.style.display = items.length ? 'none' : 'block';
        })
        .catch(function () {
            marketplaceCatalog = [];
            renderMarketplaceCatalog([]);
            var noMsg = document.getElementById('marketplace-no-items-msg');
            if (noMsg) noMsg.style.display = 'block';
        });
}

/**
 * Return the image src to use for marketplace display. For Google Drive and Imgur we use the
 * backend image proxy so Drive share links and Imgur albums work (they fail when loaded directly).
 */
function getMarketplaceImageSrc(url) {
    if (!url || typeof url !== 'string') return '';
    var u = url.trim();
    if (/drive\.google\.com/i.test(u) || /imgur\.com/i.test(u)) {
        return '/api/marketplace/image-proxy?url=' + encodeURIComponent(u);
    }
    // Other hosts: normalize single-image Imgur page URLs only (no proxy)
    if (/^https?:\/\/(www\.)?imgur\.com\/[a-zA-Z0-9]+(\?.*)?$/.test(u)) {
        var code = u.replace(/^https?:\/\/(www\.)?imgur\.com\/([a-zA-Z0-9]+).*$/, '$2');
        if (code && code !== 'a') return 'https://i.imgur.com/' + code + '.jpg';
    }
    return u;
}

function renderMarketplaceCatalog(items) {
    var grid = document.getElementById('marketplace-items-grid');
    if (!grid) return;
    if (!items || !items.length) {
        grid.innerHTML = '';
        return;
    }
    var isStudent = window.currentUser && window.currentUser.role === 'student';
    var isStaffOrAdmin = window.currentUser && (window.currentUser.role === 'staff' || window.currentUser.role === 'admin');
    var isAdmin = window.currentUser && window.currentUser.role === 'admin';
    grid.innerHTML = items.map(function (item) {
        var imgSrc = item.image_url ? getMarketplaceImageSrc(item.image_url).replace(/"/g, '&quot;') : '';
        var noImgDiv = '<div class="marketplace-card-no-img" style="width:100%; height:140px; background:var(--bg-elevated); border-radius:var(--radius-md); margin-bottom:10px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary);">No image</div>';
        var imgHtml = item.image_url
            ? '<img src="' + imgSrc + '" alt="" referrerpolicy="no-referrer" style="width:100%; height:140px; object-fit:cover; border-radius:8px; margin-bottom:10px;" onerror="this.outerHTML=\'<div class=&quot;marketplace-card-no-img&quot; style=&quot;width:100%;height:140px;background:#e2e8f0;border-radius:8px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;color:#94a3b8;&quot;>No image</div>\';">'
            : noImgDiv;
        var btnHtml = isStudent
            ? '<button type="button" class="btn-primary marketplace-card-add-btn" style="padding:6px 12px; font-size:13px;" data-item-id="' + item.id + '" data-item-name="' + (item.name || '').replace(/"/g, '&quot;') + '" data-item-price="' + item.price + '">Add to cart</button>'
            : '';
        var staffBtns = '';
        if (isStaffOrAdmin) {
            var hasHidden = item.hidden_rules && item.hidden_rules.length > 0;
            staffBtns = '<div class="marketplace-item-staff-actions" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;">' +
                (hasHidden
                    ? '<button type="button" class="marketplace-btn-unhide btn-secondary" style="padding:4px 10px; font-size:12px;" data-item-id="' + item.id + '">Unhide / Manage</button>'
                    : '<button type="button" class="marketplace-btn-hide btn-secondary" style="padding:4px 10px; font-size:12px;" data-item-id="' + item.id + '">Hide from students</button>') +
                '</div>';
        }
        var adminBtns = '';
        if (isAdmin) {
            adminBtns = '<div class="marketplace-item-admin-actions" style="margin-top:6px; display:flex; gap:6px;">' +
                '<button type="button" class="marketplace-btn-edit btn-secondary" style="padding:4px 10px; font-size:12px;" data-item-id="' + item.id + '">Edit</button>' +
                '<button type="button" class="marketplace-btn-delete btn-secondary" style="padding:4px 10px; font-size:12px; color:#dc2626;" data-item-id="' + item.id + '">Delete</button>' +
                '</div>';
        }
        return '<div class="marketplace-item-card" style="background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:14px; box-shadow:0 1px 4px rgba(0,0,0,0.06); cursor:pointer;" data-item-id="' + item.id + '">' +
            imgHtml +
            '<h4 style="margin:0 0 8px 0; font-size:1rem;">' + (item.name || '').replace(/</g, '&lt;') + '</h4>' +
            '<p style="color:#64748b; margin:0 0 12px 0; font-size:13px; line-height:1.4; max-height:2.8em; overflow:hidden;">' + (item.description || '').replace(/</g, '&lt;').substring(0, 80) + (item.description && item.description.length > 80 ? '…' : '') + '</p>' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<span style="font-weight:700; color:var(--accent);">$' + Number(item.price).toFixed(2) + '</span>' + btnHtml +
            '</div>' + staffBtns + adminBtns + '</div>';
    }).join('');
    grid.querySelectorAll('.marketplace-item-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
            if (e.target.closest('.marketplace-card-add-btn') || e.target.closest('.marketplace-btn-hide') || e.target.closest('.marketplace-btn-unhide') || e.target.closest('.marketplace-btn-edit') || e.target.closest('.marketplace-btn-delete')) return;
            var id = parseInt(card.getAttribute('data-item-id'), 10);
            openMarketplaceItemDetailModal(id);
        });
    });
    grid.querySelectorAll('.marketplace-card-add-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); });
        btn.addEventListener('click', function () {
            var id = parseInt(btn.getAttribute('data-item-id'), 10);
            var name = btn.getAttribute('data-item-name') || '';
            var price = parseFloat(btn.getAttribute('data-item-price'), 10) || 0;
            addToMarketplaceCart(id, name, price, 1);
        });
    });
    grid.querySelectorAll('.marketplace-btn-hide').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openMarketplaceHideModal(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
    grid.querySelectorAll('.marketplace-btn-unhide').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openMarketplaceUnhideModal(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
    grid.querySelectorAll('.marketplace-btn-edit').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openMarketplaceEditModal(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
    grid.querySelectorAll('.marketplace-btn-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); confirmDeleteMarketplaceItem(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
}

function openMarketplaceItemDetailModal(itemId) {
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var modal = document.getElementById('marketplace-item-detail-modal');
    var imgEl = document.getElementById('marketplace-item-detail-image');
    var imgWrap = document.querySelector('.marketplace-item-detail-image-wrap');
    var nameEl = document.getElementById('marketplace-item-detail-name');
    var metaEl = document.getElementById('marketplace-item-detail-meta');
    var descEl = document.getElementById('marketplace-item-detail-description');
    var priceEl = document.getElementById('marketplace-item-detail-price');
    var addBtn = document.getElementById('marketplace-item-detail-add-cart');
    if (!modal || !nameEl) return;
    nameEl.textContent = item.name || '';
    var metaParts = [];
    if (item.item_type_name) metaParts.push(item.item_type_name);
    if (item.category_name) metaParts.push(item.category_name);
    metaEl.textContent = metaParts.length ? metaParts.join(' · ') : '';
    metaEl.style.display = metaParts.length ? 'block' : 'none';
    descEl.textContent = item.description || 'No description.';
    descEl.style.display = (item.description || '').trim() ? 'block' : 'block';
    priceEl.textContent = '$' + Number(item.price).toFixed(2);
    var noImgEl = document.getElementById('marketplace-item-detail-no-image');
    if (imgEl && imgWrap) {
        if (item.image_url) {
            imgEl.src = getMarketplaceImageSrc(item.image_url);
            imgEl.referrerPolicy = 'no-referrer';
            imgEl.alt = item.name || '';
            imgEl.style.display = 'block';
            imgWrap.style.display = 'block';
            if (noImgEl) noImgEl.style.display = 'none';
            imgEl.onerror = function () {
                imgEl.style.display = 'none';
                if (noImgEl) { noImgEl.style.display = 'flex'; noImgEl.style.alignItems = 'center'; noImgEl.style.justifyContent = 'center'; }
            };
        } else {
            imgEl.style.display = 'none';
            if (noImgEl) { noImgEl.style.display = 'flex'; noImgEl.style.alignItems = 'center'; noImgEl.style.justifyContent = 'center'; }
            imgWrap.style.display = 'block';
        }
    }
    if (addBtn) {
        addBtn.style.display = (window.currentUser && window.currentUser.role === 'student') ? 'inline-block' : 'none';
        addBtn.onclick = function () {
            addToMarketplaceCart(item.id, item.name || '', item.price, 1);
            closeMarketplaceItemDetailModal();
        };
    }
    modal.setAttribute('data-marketplace-detail-item-id', String(itemId));
    modal.style.display = 'block';
}

function closeMarketplaceItemDetailModal() {
    var modal = document.getElementById('marketplace-item-detail-modal');
    if (modal) modal.style.display = 'none';
}

function bindMarketplaceItemDetailModal() {
    var modal = document.getElementById('marketplace-item-detail-modal');
    var closeBtn = document.getElementById('marketplace-item-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeMarketplaceItemDetailModal);
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeMarketplaceItemDetailModal();
        });
    }
}

function loadMarketplaceTypesAndCategories() {
    fetch('/api/marketplace/types').then(function (r) { return r.ok ? r.json() : []; }).then(function (types) {
        var sel = document.getElementById('marketplace-filter-type');
        if (!sel) return;
        sel.innerHTML = '<option value="">All types</option>';
        types.forEach(function (t) {
            var o = document.createElement('option');
            o.value = t.id;
            o.textContent = t.name;
            sel.appendChild(o);
        });
    });
    fetch('/api/marketplace/categories').then(function (r) { return r.ok ? r.json() : []; }).then(function (cats) {
        var sel = document.getElementById('marketplace-filter-category');
        if (!sel) return;
        sel.innerHTML = '<option value="">All categories</option>';
        cats.forEach(function (c) {
            var o = document.createElement('option');
            o.value = c.id;
            o.textContent = c.name;
            sel.appendChild(o);
        });
    });
}

function loadMarketplacePOApprovals() {
    var list = document.getElementById('marketplace-po-approvals-list');
    if (!list) return;
    fetch('/api/purchase-orders')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (orders) {
            var pending = orders.filter(function (o) { return o.status === 'pending'; });
            if (!pending.length) {
                list.innerHTML = '<p style="margin:0; color:#94a3b8;">No pending purchase orders.</p>';
                return;
            }
            list.innerHTML = pending.map(function (o) {
                return '<div style="border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:10px; background:var(--bg-surface);">' +
                    '<div style="font-weight:600;">' + (o.item_name || '').replace(/</g, '&lt;') + ' — $' + Number(o.item_price).toFixed(2) + '</div>' +
                    '<div style="font-size:13px; color:#64748b;">Student: ' + (o.student_name || '').replace(/</g, '&lt;') + '</div>' +
                    '<div style="font-size:13px; color:#64748b;">' + (o.created_at ? new Date(o.created_at).toLocaleString() : '') + '</div>' +
                    '<div style="margin-top:10px; display:flex; gap:8px; align-items:center;">' +
                    '<button type="button" class="btn-primary" style="padding:6px 12px;" data-po-approve="' + o.id + '">Fulfill</button>' +
                    '<button type="button" class="btn-secondary" style="padding:6px 12px;" data-po-deny="' + o.id + '">Deny</button>' +
                    '<input type="text" placeholder="Reason (optional)" data-po-deny-reason="' + o.id + '" style="flex:1; padding:6px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:13px;">' +
                    '</div></div>';
            }).join('');
            list.querySelectorAll('[data-po-approve]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = parseInt(btn.getAttribute('data-po-approve'), 10);
                    marketplaceUpdatePOStatus(id, 'approved');
                });
            });
            list.querySelectorAll('[data-po-deny]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = parseInt(btn.getAttribute('data-po-deny'), 10);
                    var reasonEl = document.querySelector('[data-po-deny-reason="' + id + '"]');
                    var reason = reasonEl && reasonEl.value ? reasonEl.value.trim() : '';
                    marketplaceUpdatePOStatus(id, 'denied', reason);
                });
            });
        })
        .catch(function () {
            list.innerHTML = '<p style="margin:0; color:#dc2626;">Failed to load orders.</p>';
        });
}

function marketplaceUpdatePOStatus(orderId, status, denialReason) {
    var body = { status: status };
    if (status === 'denied' && denialReason) body.denial_reason = denialReason;
    fetch('/api/purchase-orders/' + orderId + '/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
            if (res.ok) {
                showMessage(res.data.message || 'Updated', 'success');
                loadMarketplacePOApprovals();
                loadMarketplaceAnalytics();
            } else {
                showMessage(res.data.error || 'Error', 'error');
            }
        })
        .catch(function () {
            showMessage('Error updating order', 'error');
        });
}

var marketplaceAnalyticsCharts = { most: null, least: null, grade: null, color: null };
var marketplaceAnalyticsData = null;

function destroyMarketplaceAnalyticsCharts() {
    ['most', 'least', 'grade', 'color'].forEach(function (k) {
        if (marketplaceAnalyticsCharts[k]) {
            marketplaceAnalyticsCharts[k].destroy();
            marketplaceAnalyticsCharts[k] = null;
        }
    });
}

function renderMarketplaceAnalyticsCharts(data) {
    if (typeof Chart === 'undefined') return;
    destroyMarketplaceAnalyticsCharts();
    var palette = ['#2563EB', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#ec4899', '#84cc16'];
    var hex = function (i) { return palette[i % palette.length]; };

    var mostEl = document.getElementById('marketplace-analytics-most-chart');
    var leastEl = document.getElementById('marketplace-analytics-least-chart');
    var mostEmpty = document.getElementById('marketplace-analytics-most-empty');
    var leastEmpty = document.getElementById('marketplace-analytics-least-empty');
    var mostWrap = document.getElementById('marketplace-analytics-most-wrap');
    var leastWrap = document.getElementById('marketplace-analytics-least-wrap');
    if (mostEmpty && mostWrap) {
        mostEmpty.style.display = data.most_purchased.length ? 'none' : 'block';
        mostWrap.style.display = data.most_purchased.length ? 'block' : 'none';
    }
    if (leastEmpty && leastWrap) {
        leastEmpty.style.display = data.least_purchased.length ? 'none' : 'block';
        leastWrap.style.display = data.least_purchased.length ? 'block' : 'none';
    }
    if (mostEl && data.most_purchased.length) {
        var mostCtx = mostEl.getContext('2d');
        marketplaceAnalyticsCharts.most = new Chart(mostCtx, {
            type: 'bar',
            data: {
                labels: data.most_purchased.map(function (x) { return x.item_name.length > 20 ? x.item_name.slice(0, 17) + '…' : x.item_name; }),
                datasets: [{ label: 'Purchases', data: data.most_purchased.map(function (x) { return x.purchase_count; }), backgroundColor: data.most_purchased.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
    if (leastEl && data.least_purchased.length) {
        var leastCtx = leastEl.getContext('2d');
        marketplaceAnalyticsCharts.least = new Chart(leastCtx, {
            type: 'bar',
            data: {
                labels: data.least_purchased.map(function (x) { return x.item_name.length > 20 ? x.item_name.slice(0, 17) + '…' : x.item_name; }),
                datasets: [{ label: 'Purchases', data: data.least_purchased.map(function (x) { return x.purchase_count; }), backgroundColor: data.least_purchased.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
}

function wireChartJsDoughnutLegendColumns(chart) {
    if (!chart || chart.config?.type !== 'doughnut') return;
    const legendOpts = chart.options?.plugins?.legend;
    if (!legendOpts || legendOpts.display === false) return;

    const labelCount = Array.isArray(chart.data?.labels) ? chart.data.labels.length : 0;
    const useThreeCols = labelCount > 4;

    const apply = () => {
        const root = chart.canvas?.parentElement;
        const legendEl =
            root?.querySelector?.('.chartjs-legend') ||
            document.querySelector(`div.chartjs-legend[data-chart="${chart.id}"]`);
        if (!legendEl) return;
        const host = legendEl.classList?.contains('chartjs-legend')
            ? legendEl
            : legendEl.closest('.chartjs-legend') || legendEl;
        host.classList.toggle('chartjs-legend--cols-3', useThreeCols);
    };

    const plugins = chart.config.plugins || (chart.config.plugins = []);
    const hookName = '_donutLegendColsWired';
    if (!plugins.some((p) => p && p[hookName])) {
        plugins.push({
            [hookName]: true,
            afterUpdate: apply,
            afterLayout: apply,
        });
    }

    requestAnimationFrame(apply);
}

function renderMarketplaceAnalyticsDemographics(itemId) {
    var placeholder = document.getElementById('marketplace-analytics-demographics-placeholder');
    var chartsWrap = document.getElementById('marketplace-analytics-demographics-charts');
    var gradeCanvas = document.getElementById('marketplace-analytics-grade-chart');
    var colorCanvas = document.getElementById('marketplace-analytics-color-chart');
    if (!placeholder || !chartsWrap || !gradeCanvas || !colorCanvas || !marketplaceAnalyticsData || typeof Chart === 'undefined') return;
    var demo = marketplaceAnalyticsData.demographics_by_item && (marketplaceAnalyticsData.demographics_by_item[itemId] || marketplaceAnalyticsData.demographics_by_item[String(itemId)]);
    if (!itemId || !demo) {
        placeholder.style.display = 'block';
        chartsWrap.style.display = 'none';
        if (marketplaceAnalyticsCharts.grade) { marketplaceAnalyticsCharts.grade.destroy(); marketplaceAnalyticsCharts.grade = null; }
        if (marketplaceAnalyticsCharts.color) { marketplaceAnalyticsCharts.color.destroy(); marketplaceAnalyticsCharts.color = null; }
        return;
    }
    var d = demo;
    var byGrade = d.by_grade || {};
    var byColor = d.by_card_color || {};
    var gradeLabels = Object.keys(byGrade).sort();
    var colorLabels = Object.keys(byColor).sort();
    var gradeDisplay = function (k) { return k === '(none)' ? 'No grade' : k; };
    var colorDisplay = function (k) { return k === 'none' ? 'No color' : (k.charAt(0).toUpperCase() + k.slice(1)); };
    var palette = ['#2563EB', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#ec4899', '#84cc16'];
    var hex = function (i) { return palette[i % palette.length]; };
    placeholder.style.display = 'none';
    chartsWrap.style.display = 'grid';
    if (marketplaceAnalyticsCharts.grade) { marketplaceAnalyticsCharts.grade.destroy(); marketplaceAnalyticsCharts.grade = null; }
    if (marketplaceAnalyticsCharts.color) { marketplaceAnalyticsCharts.color.destroy(); marketplaceAnalyticsCharts.color = null; }
    if (gradeLabels.length) {
        var gCtx = gradeCanvas.getContext('2d');
        marketplaceAnalyticsCharts.grade = new Chart(gCtx, {
            type: 'bar',
            data: {
                labels: gradeLabels.map(gradeDisplay),
                datasets: [{ label: 'Purchases', data: gradeLabels.map(function (k) { return byGrade[k]; }), backgroundColor: gradeLabels.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
    if (colorLabels.length) {
        var cCtx = colorCanvas.getContext('2d');
        marketplaceAnalyticsCharts.color = new Chart(cCtx, {
            type: 'doughnut',
            data: {
                labels: colorLabels.map(colorDisplay),
                datasets: [{ data: colorLabels.map(function (k) { return byColor[k]; }), backgroundColor: colorLabels.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
        wireChartJsDoughnutLegendColumns(marketplaceAnalyticsCharts.color);
    }
}

function loadMarketplaceAnalytics() {
    var section = document.getElementById('marketplace-analytics-section');
    var loadingEl = document.getElementById('marketplace-analytics-loading');
    var contentEl = document.getElementById('marketplace-analytics-content');
    var errorEl = document.getElementById('marketplace-analytics-error');
    var neverMsg = document.getElementById('marketplace-analytics-never-msg');
    var neverList = document.getElementById('marketplace-analytics-never-list');
    var itemSelect = document.getElementById('marketplace-analytics-item-select');
    if (!section || !loadingEl || !contentEl) return;
    loadingEl.style.display = 'block';
    contentEl.style.display = 'none';
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
    fetch('/api/marketplace/analytics')
        .then(function (r) {
            if (!r.ok) return Promise.reject(new Error('Analytics not available'));
            return r.json();
        })
        .then(function (data) {
            marketplaceAnalyticsData = data;
            loadingEl.style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            contentEl.style.display = 'block';
            renderMarketplaceAnalyticsCharts(data);
            if (neverMsg) neverMsg.textContent = data.never_purchased.length ? 'Active items with no purchases (approved/fulfilled):' : 'No active items have zero purchases.';
            if (neverList) {
                neverList.innerHTML = data.never_purchased.map(function (x) {
                    return '<li style="margin-bottom:4px;">' + (x.item_name || '').replace(/</g, '&lt;') + '</li>';
                }).join('');
            }
            if (itemSelect) {
                var idx = data.item_index || {};
                var opts = '<option value="">— Select item —</option>';
                var ids = Object.keys(data.demographics_by_item || {}).map(Number).sort(function (a, b) {
                    var na = idx[a] || idx[String(a)] || '';
                    var nb = idx[b] || idx[String(b)] || '';
                    return na.localeCompare(nb);
                });
                ids.forEach(function (id) {
                    var name = idx[id] || idx[String(id)] || 'Item #' + id;
                    opts += '<option value="' + id + '">' + (name || '').replace(/</g, '&lt;') + '</option>';
                });
                itemSelect.innerHTML = opts;
                itemSelect.value = '';
            }
            renderMarketplaceAnalyticsDemographics(null);
        })
        .catch(function () {
            loadingEl.style.display = 'none';
            contentEl.style.display = 'none';
            if (errorEl) {
                errorEl.textContent = 'Could not load analytics.';
                errorEl.style.display = 'block';
            }
        });
}

// Selected case managers (and optionally School-wide) for the Add marketplace item modal.
// Each item: { id: number|'school_wide', name: string }
var marketplaceAddItemCaseManagerOptions = [];
var marketplaceAddItemSelected = [];
var marketplaceAddItemCaseManagerBound = false;

function renderMarketplaceAddItemCaseManagerChips() {
    var container = document.getElementById('marketplace-add-item-case-manager-chips');
    if (!container) return;
    container.innerHTML = '';
    marketplaceAddItemSelected.forEach(function (item) {
        var chip = document.createElement('span');
        chip.className = 'marketplace-case-manager-chip';
        chip.setAttribute('data-id', item.id === 'school_wide' ? 'school_wide' : String(item.id));
        chip.innerHTML = '<span class="marketplace-case-manager-chip-label">' + (item.name || '').replace(/</g, '&lt;') + '</span><span class="marketplace-case-manager-chip-remove" aria-label="Remove">×</span>';
        chip.addEventListener('click', function () {
            marketplaceAddItemSelected = marketplaceAddItemSelected.filter(function (s) { return s.id !== item.id; });
            renderMarketplaceAddItemCaseManagerChips();
            renderMarketplaceAddItemCaseManagerDropdown();
        });
        container.appendChild(chip);
    });
}

function renderMarketplaceAddItemCaseManagerDropdown() {
    var input = document.getElementById('marketplace-add-item-case-manager-input');
    var dropdown = document.getElementById('marketplace-add-item-case-manager-dropdown');
    if (!input || !dropdown) return;
    var q = (input.value || '').trim().toLowerCase();
    var frag = document.createDocumentFragment();
    marketplaceAddItemCaseManagerOptions.forEach(function (opt) {
        var label = (opt.name || '').trim();
        if (q && label.toLowerCase().indexOf(q) === -1) return;
        var isSelected = marketplaceAddItemSelected.some(function (s) {
            return s.id === opt.id || (opt.id === 'school_wide' && s.id === 'school_wide');
        });
        var div = document.createElement('div');
        div.className = 'marketplace-combobox-option' + (isSelected ? ' is-selected' : '');
        div.setAttribute('role', 'option');
        div.setAttribute('data-id', opt.id === 'school_wide' ? 'school_wide' : String(opt.id));
        div.setAttribute('data-name', label);
        div.textContent = label;
        frag.appendChild(div);
    });
    dropdown.innerHTML = '';
    dropdown.appendChild(frag);
    if (frag.childNodes.length > 0) {
        dropdown.classList.add('is-open');
    } else {
        dropdown.classList.remove('is-open');
    }
}

function openMarketplaceAddItemModal() {
    var modal = document.getElementById('marketplace-add-item-modal');
    var errEl = document.getElementById('marketplace-add-item-error');
    var nameIn = document.getElementById('marketplace-add-item-name');
    var descIn = document.getElementById('marketplace-add-item-description');
    var priceIn = document.getElementById('marketplace-add-item-price');
    var caseManagerInput = document.getElementById('marketplace-add-item-case-manager-input');
    var caseManagerDropdown = document.getElementById('marketplace-add-item-case-manager-dropdown');
    var typeInput = document.getElementById('marketplace-add-item-type-input');
    var typeIdHidden = document.getElementById('marketplace-add-item-type-id');
    var typeDropdown = document.getElementById('marketplace-add-item-type-dropdown');
    var catInput = document.getElementById('marketplace-add-item-category-input');
    var catIdHidden = document.getElementById('marketplace-add-item-category-id');
    var catDropdown = document.getElementById('marketplace-add-item-category-dropdown');
    var imgIn = document.getElementById('marketplace-add-item-image-url');
    if (!modal || !nameIn || !priceIn) return;
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    nameIn.value = '';
    if (descIn) descIn.value = '';
    priceIn.value = '';
    marketplaceAddItemSelected = [];
    if (caseManagerInput) caseManagerInput.value = '';
    if (typeInput) typeInput.value = '';
    if (typeIdHidden) typeIdHidden.value = '';
    if (catInput) catInput.value = '';
    if (catIdHidden) catIdHidden.value = '';
    if (imgIn) imgIn.value = '';
    var isAdmin = window.currentUser && window.currentUser.role === 'admin';
    // Build options: School-wide (admin only) then case managers
    fetch('/api/marketplace/case-managers').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
        marketplaceAddItemCaseManagerOptions = [];
        if (isAdmin) {
            marketplaceAddItemCaseManagerOptions.push({ id: 'school_wide', name: 'School-wide' });
        }
        (list || []).forEach(function (cm) {
            marketplaceAddItemCaseManagerOptions.push({
                id: cm.id,
                name: (cm.name || cm.username || 'User #' + cm.id).trim()
            });
        });
        renderMarketplaceAddItemCaseManagerChips();
        renderMarketplaceAddItemCaseManagerDropdown();
        var me = window.currentUser && window.currentUser.id;
        if (me && list.some(function (cm) { return cm.id === me; })) {
            var meOpt = marketplaceAddItemCaseManagerOptions.find(function (o) { return o.id === me; });
            if (meOpt) {
                marketplaceAddItemSelected.push(meOpt);
                renderMarketplaceAddItemCaseManagerChips();
                renderMarketplaceAddItemCaseManagerDropdown();
            }
        }
    }).catch(function () {});
    if (!marketplaceAddItemCaseManagerBound && caseManagerInput && caseManagerDropdown) {
        marketplaceAddItemCaseManagerBound = true;
        var caseManagerCloseTimer = null;
        caseManagerInput.addEventListener('focus', function () { renderMarketplaceAddItemCaseManagerDropdown(); });
        caseManagerInput.addEventListener('input', function () { renderMarketplaceAddItemCaseManagerDropdown(); });
        caseManagerInput.addEventListener('blur', function () {
            caseManagerCloseTimer = setTimeout(function () { caseManagerDropdown.classList.remove('is-open'); }, 150);
        });
        caseManagerInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') caseManagerDropdown.classList.remove('is-open');
        });
        caseManagerDropdown.addEventListener('mousedown', function (e) { e.preventDefault(); });
        caseManagerDropdown.addEventListener('click', function (e) {
            var opt = e.target && e.target.closest && e.target.closest('.marketplace-combobox-option');
            if (!opt) return;
            if (caseManagerCloseTimer) { clearTimeout(caseManagerCloseTimer); caseManagerCloseTimer = null; }
            var id = opt.getAttribute('data-id');
            var name = opt.getAttribute('data-name') || opt.textContent;
            if (id === 'school_wide') {
                var idx = marketplaceAddItemSelected.findIndex(function (s) { return s.id === 'school_wide'; });
                if (idx >= 0) {
                    marketplaceAddItemSelected.splice(idx, 1);
                } else {
                    marketplaceAddItemSelected.push({ id: 'school_wide', name: name });
                }
            } else {
                var numId = parseInt(id, 10);
                var idx = marketplaceAddItemSelected.findIndex(function (s) { return s.id === numId; });
                if (idx >= 0) {
                    marketplaceAddItemSelected.splice(idx, 1);
                } else {
                    marketplaceAddItemSelected.push({ id: numId, name: name });
                }
            }
            renderMarketplaceAddItemCaseManagerChips();
            renderMarketplaceAddItemCaseManagerDropdown();
        });
    }
    var typesList = [];
    var catsList = [];
    function renderTypeDropdown() {
        if (!typeDropdown || !typeInput) return;
        var q = (typeInput.value || '').trim().toLowerCase();
        var frag = document.createDocumentFragment();
        typesList.forEach(function (t) {
            if (q && t.name.toLowerCase().indexOf(q) === -1) return;
            var div = document.createElement('div');
            div.className = 'marketplace-combobox-option';
            div.setAttribute('role', 'option');
            div.setAttribute('data-id', t.id);
            div.textContent = t.name;
            frag.appendChild(div);
        });
        if (q && !typesList.some(function (t) { return t.name.toLowerCase() === q; })) {
            var addDiv = document.createElement('div');
            addDiv.className = 'marketplace-combobox-option add-new';
            addDiv.setAttribute('role', 'option');
            addDiv.setAttribute('data-add', q);
            addDiv.textContent = 'Add "' + q + '"';
            frag.appendChild(addDiv);
        }
        typeDropdown.innerHTML = '';
        typeDropdown.appendChild(frag);
        typeDropdown.classList.toggle('is-open', frag.childNodes.length > 0 && typeInput === document.activeElement);
    }
    function renderCatDropdown() {
        if (!catDropdown || !catInput) return;
        var q = (catInput.value || '').trim().toLowerCase();
        var frag = document.createDocumentFragment();
        catsList.forEach(function (c) {
            if (q && c.name.toLowerCase().indexOf(q) === -1) return;
            var div = document.createElement('div');
            div.className = 'marketplace-combobox-option';
            div.setAttribute('role', 'option');
            div.setAttribute('data-id', c.id);
            div.textContent = c.name;
            frag.appendChild(div);
        });
        if (q && !catsList.some(function (c) { return c.name.toLowerCase() === q; })) {
            var addDiv = document.createElement('div');
            addDiv.className = 'marketplace-combobox-option add-new';
            addDiv.setAttribute('role', 'option');
            addDiv.setAttribute('data-add', q);
            addDiv.textContent = 'Add "' + q + '"';
            frag.appendChild(addDiv);
        }
        catDropdown.innerHTML = '';
        catDropdown.appendChild(frag);
        catDropdown.classList.toggle('is-open', frag.childNodes.length > 0 && catInput === document.activeElement);
    }
    function setupTypeCombobox() {
        if (!typeInput || !typeIdHidden || !typeDropdown) return;
        var typeCloseTimer = null;
        typeInput.addEventListener('focus', function () { renderTypeDropdown(); });
        typeInput.addEventListener('input', function () {
            var sel = typesList.find(function (t) { return String(t.id) === (typeIdHidden && typeIdHidden.value); });
            if (sel && typeInput.value !== sel.name) { if (typeIdHidden) typeIdHidden.value = ''; }
            renderTypeDropdown();
        });
        typeInput.addEventListener('blur', function () {
            typeCloseTimer = setTimeout(function () { typeDropdown.classList.remove('is-open'); }, 150);
        });
        typeInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { typeDropdown.classList.remove('is-open'); }
        });
        typeDropdown.addEventListener('mousedown', function (e) { e.preventDefault(); });
        typeDropdown.addEventListener('click', function (e) {
            var opt = e.target && e.target.closest && e.target.closest('.marketplace-combobox-option');
            if (!opt) return;
            if (typeCloseTimer) { clearTimeout(typeCloseTimer); typeCloseTimer = null; }
            var id = opt.getAttribute('data-id');
            var addName = opt.getAttribute('data-add');
            if (id) {
                typeIdHidden.value = id;
                typeInput.value = opt.textContent;
                typeDropdown.classList.remove('is-open');
            } else if (addName) {
                fetch('/api/marketplace/types', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: addName })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); }).then(function (res) {
                    if (res.ok && res.data && res.data.id) {
                        typesList.push({ id: res.data.id, name: res.data.name });
                        typeIdHidden.value = String(res.data.id);
                        typeInput.value = res.data.name;
                        typeDropdown.classList.remove('is-open');
                    } else {
                        showMessage(res.data && res.data.error ? res.data.error : 'Could not add type.', 'error');
                    }
                }).catch(function () { showMessage('Could not add type.', 'error'); });
            }
        });
    }
    function setupCatCombobox() {
        if (!catInput || !catIdHidden || !catDropdown) return;
        var catCloseTimer = null;
        catInput.addEventListener('focus', function () { renderCatDropdown(); });
        catInput.addEventListener('input', function () {
            var sel = catsList.find(function (c) { return String(c.id) === (catIdHidden && catIdHidden.value); });
            if (sel && catInput.value !== sel.name) { if (catIdHidden) catIdHidden.value = ''; }
            renderCatDropdown();
        });
        catInput.addEventListener('blur', function () {
            catCloseTimer = setTimeout(function () { catDropdown.classList.remove('is-open'); }, 150);
        });
        catInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { catDropdown.classList.remove('is-open'); }
        });
        catDropdown.addEventListener('mousedown', function (e) { e.preventDefault(); });
        catDropdown.addEventListener('click', function (e) {
            var opt = e.target && e.target.closest && e.target.closest('.marketplace-combobox-option');
            if (!opt) return;
            if (catCloseTimer) { clearTimeout(catCloseTimer); catCloseTimer = null; }
            var id = opt.getAttribute('data-id');
            var addName = opt.getAttribute('data-add');
            if (id) {
                catIdHidden.value = id;
                catInput.value = opt.textContent;
                catDropdown.classList.remove('is-open');
            } else if (addName) {
                fetch('/api/marketplace/categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: addName })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); }).then(function (res) {
                    if (res.ok && res.data && res.data.id) {
                        catsList.push({ id: res.data.id, name: res.data.name });
                        catIdHidden.value = String(res.data.id);
                        catInput.value = res.data.name;
                        catDropdown.classList.remove('is-open');
                    } else {
                        showMessage(res.data && res.data.error ? res.data.error : 'Could not add category.', 'error');
                    }
                }).catch(function () { showMessage('Could not add category.', 'error'); });
            }
        });
    }
    setupTypeCombobox();
    setupCatCombobox();
    fetch('/api/marketplace/types').then(function (r) { return r.ok ? r.json() : []; }).then(function (types) {
        typesList = types;
        renderTypeDropdown();
    });
    fetch('/api/marketplace/categories').then(function (r) { return r.ok ? r.json() : []; }).then(function (cats) {
        catsList = cats;
        renderCatDropdown();
    });
    modal.style.display = 'block';
}

function closeMarketplaceAddItemModal() {
    var modal = document.getElementById('marketplace-add-item-modal');
    if (modal) modal.style.display = 'none';
    var popover = document.getElementById('marketplace-add-item-image-url-info');
    if (popover) popover.classList.remove('is-visible');
}

function submitMarketplaceAddItem() {
    var nameIn = document.getElementById('marketplace-add-item-name');
    var descIn = document.getElementById('marketplace-add-item-description');
    var priceIn = document.getElementById('marketplace-add-item-price');
    var typeIdHidden = document.getElementById('marketplace-add-item-type-id');
    var catIdHidden = document.getElementById('marketplace-add-item-category-id');
    var imgIn = document.getElementById('marketplace-add-item-image-url');
    var errEl = document.getElementById('marketplace-add-item-error');
    var name = nameIn && nameIn.value ? nameIn.value.trim() : '';
    var price = priceIn && priceIn.value ? parseFloat(priceIn.value, 10) : NaN;
    if (!name) {
        if (errEl) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; }
        return;
    }
    if (!price || isNaN(price) || price <= 0) {
        if (errEl) { errEl.textContent = 'Please enter a valid price.'; errEl.style.display = 'block'; }
        return;
    }
    var hasSchoolWide = marketplaceAddItemSelected.some(function (s) { return s.id === 'school_wide'; });
    var caseManagerIds = marketplaceAddItemSelected.filter(function (s) { return s.id !== 'school_wide'; }).map(function (s) { return s.id; });
    if (!hasSchoolWide && caseManagerIds.length === 0) {
        if (errEl) { errEl.textContent = 'Select at least one Case Manager or School-wide (admins only).'; errEl.style.display = 'block'; }
        return;
    }
    var rawType = typeIdHidden && typeIdHidden.value ? typeIdHidden.value.trim() : '';
    var rawCat = catIdHidden && catIdHidden.value ? catIdHidden.value.trim() : '';
    var typeId = rawType ? parseInt(rawType, 10) : null;
    var catId = rawCat ? parseInt(rawCat, 10) : null;
    var payload = {
        name: name,
        description: (descIn && descIn.value) ? descIn.value.trim() : '',
        price: price,
        case_manager_ids: caseManagerIds,
        is_school_wide: hasSchoolWide,
        item_type_id: typeId,
        category_id: catId,
        image_url: (imgIn && imgIn.value) ? imgIn.value.trim() : null
    };
    if (!payload.item_type_id) delete payload.item_type_id;
    if (!payload.category_id) delete payload.category_id;
    if (!payload.image_url) delete payload.image_url;
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    fetch('/api/marketplace-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function (r) {
            return r.text().then(function (text) {
                var data = null;
                try { data = text ? JSON.parse(text) : {}; } catch (_) { }
                return { ok: r.ok, status: r.status, data: data, text: text };
            });
        })
        .then(function (res) {
            if (res.ok) {
                closeMarketplaceAddItemModal();
                showMessage('Item added.', 'success');
                if (getMarketplaceStudentId()) loadMarketplaceCatalog();
            } else {
                var msg = (res.data && res.data.error) ? res.data.error : (res.status === 500 ? 'Server error. Please try again or contact support.' : 'Failed to add item.');
                if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            }
        })
        .catch(function (e) {
            if (errEl) { errEl.textContent = 'Network or server error. Please try again.'; errEl.style.display = 'block'; }
        });
}

var marketplaceHideModalItemId = null;
function openMarketplaceHideModal(itemId) {
    marketplaceHideModalItemId = itemId;
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    var modal = document.getElementById('marketplace-hide-modal');
    var nameEl = document.getElementById('marketplace-hide-item-name');
    if (nameEl) nameEl.textContent = item ? item.name : '';
    document.querySelectorAll('input[name="marketplace-hide-type"]').forEach(function (r) { r.checked = false; });
    document.getElementById('marketplace-hide-value-student').style.display = 'none';
    document.getElementById('marketplace-hide-value-color').style.display = 'none';
    document.getElementById('marketplace-hide-value-grade').style.display = 'none';
    document.getElementById('marketplace-hide-student-id').value = '';
    document.getElementById('marketplace-hide-student-search').value = '';
    document.getElementById('marketplace-hide-card-color').value = '';
    document.getElementById('marketplace-hide-grade').value = '';
    var errEl = document.getElementById('marketplace-hide-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (modal) modal.style.display = 'block';
}
function closeMarketplaceHideModal() {
    marketplaceHideModalItemId = null;
    var modal = document.getElementById('marketplace-hide-modal');
    if (modal) modal.style.display = 'none';
}
function submitMarketplaceHide() {
    var itemId = marketplaceHideModalItemId;
    if (!itemId) return;
    var typeRadios = document.querySelectorAll('input[name="marketplace-hide-type"]');
    var type = null;
    typeRadios.forEach(function (r) { if (r.checked) type = r.value; });
    var value = '';
    if (type === 'student') {
        value = document.getElementById('marketplace-hide-student-id').value.trim();
        if (!value) { document.getElementById('marketplace-hide-error').textContent = 'Select a student.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return; }
    } else if (type === 'card_color') {
        value = document.getElementById('marketplace-hide-card-color').value.trim();
        if (!value) { document.getElementById('marketplace-hide-error').textContent = 'Select a card color.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return; }
    } else if (type === 'grade_section') {
        value = document.getElementById('marketplace-hide-grade').value.trim();
        if (!value) { document.getElementById('marketplace-hide-error').textContent = 'Select a grade section.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return; }
    } else {
        document.getElementById('marketplace-hide-error').textContent = 'Choose one: specific student, card color, or grade.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return;
    }
    var errEl = document.getElementById('marketplace-hide-error');
    errEl.style.display = 'none';
    fetch('/api/marketplace-items/' + itemId + '/hidden-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden_type: type, value: value })
    })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
            if (res.ok || (res.data && res.data.id)) {
                closeMarketplaceHideModal();
                loadMarketplaceCatalog();
            } else {
                errEl.textContent = (res.data && res.data.error) || 'Failed to add rule.'; errEl.style.display = 'block';
            }
        })
        .catch(function () { errEl.textContent = 'Failed to add rule.'; errEl.style.display = 'block'; });
}

var marketplaceUnhideModalItemId = null;
function openMarketplaceUnhideModal(itemId) {
    marketplaceUnhideModalItemId = itemId;
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    var modal = document.getElementById('marketplace-unhide-modal');
    var nameEl = document.getElementById('marketplace-unhide-item-name');
    if (nameEl) nameEl.textContent = item ? item.name : '';
    var listEl = document.getElementById('marketplace-unhide-rules-list');
    if (!listEl) { if (modal) modal.style.display = 'block'; return; }
    listEl.innerHTML = '';
    var rules = (item && item.hidden_rules) ? item.hidden_rules : [];
    if (!rules.length) {
        listEl.innerHTML = '<li style="color:#94a3b8;">No visibility rules.</li>';
    } else {
        rules.forEach(function (r) {
            var label = r.hidden_type === 'student' ? 'Student ' + r.value : r.hidden_type === 'card_color' ? 'Card color: ' + r.value : 'Grade section: ' + r.value;
            var li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;';
            li.innerHTML = '<span>' + String(label).replace(/</g, '&lt;') + '</span><button type="button" class="marketplace-unhide-remove-rule btn-secondary" style="padding:4px 10px; font-size:12px;" data-rule-id="' + r.id + '">Remove</button>';
            listEl.appendChild(li);
            li.querySelector('.marketplace-unhide-remove-rule').addEventListener('click', function () { removeMarketplaceHiddenRule(itemId, r.id); });
        });
    }
    if (modal) modal.style.display = 'block';
}
function closeMarketplaceUnhideModal() {
    marketplaceUnhideModalItemId = null;
    var modal = document.getElementById('marketplace-unhide-modal');
    if (modal) modal.style.display = 'none';
}
function removeMarketplaceHiddenRule(itemId, ruleId) {
    fetch('/api/marketplace-items/' + itemId + '/hidden-rules/' + ruleId, { method: 'DELETE' })
        .then(function (r) {
            if (r.ok) {
                loadMarketplaceCatalog();
                fetch('/api/marketplace-items/' + itemId + '/hidden-rules')
                    .then(function (res) { return res.ok ? res.json() : []; })
                    .then(function (rules) {
                        var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
                        if (item) item.hidden_rules = rules;
                        var listEl = document.getElementById('marketplace-unhide-rules-list');
                        if (!listEl) return;
                        listEl.innerHTML = '';
                        if (!rules.length) {
                            listEl.innerHTML = '<li style="color:#94a3b8;">No visibility rules.</li>';
                            closeMarketplaceUnhideModal();
                        } else {
                            rules.forEach(function (r) {
                                var label = r.hidden_type === 'student' ? 'Student ' + r.value : r.hidden_type === 'card_color' ? 'Card color: ' + r.value : 'Grade section: ' + r.value;
                                var li = document.createElement('li');
                                li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;';
                                li.innerHTML = '<span>' + String(label).replace(/</g, '&lt;') + '</span><button type="button" class="marketplace-unhide-remove-rule btn-secondary" style="padding:4px 10px; font-size:12px;" data-rule-id="' + r.id + '">Remove</button>';
                                listEl.appendChild(li);
                                li.querySelector('.marketplace-unhide-remove-rule').addEventListener('click', function () { removeMarketplaceHiddenRule(itemId, r.id); });
                            });
                        }
                    });
            }
        });
}
function refreshMarketplaceUnhideModalList() {
    if (marketplaceUnhideModalItemId == null) return;
    fetch('/api/marketplace-items/' + marketplaceUnhideModalItemId + '/hidden-rules')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rules) {
            var item = marketplaceCatalog.find(function (x) { return x.id === marketplaceUnhideModalItemId; });
            if (item) item.hidden_rules = rules;
            var listEl = document.getElementById('marketplace-unhide-rules-list');
            if (!listEl) return;
            listEl.innerHTML = '';
            if (!rules.length) {
                listEl.innerHTML = '<li style="color:#94a3b8;">No visibility rules.</li>';
                closeMarketplaceUnhideModal();
            } else {
                rules.forEach(function (r) {
                    var label = r.hidden_type === 'student' ? 'Student ' + r.value : r.hidden_type === 'card_color' ? 'Card color: ' + r.value : 'Grade section: ' + r.value;
                    var li = document.createElement('li');
                    li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;';
                    li.innerHTML = '<span>' + String(label).replace(/</g, '&lt;') + '</span><button type="button" class="marketplace-unhide-remove-rule btn-secondary" style="padding:4px 10px; font-size:12px;" data-rule-id="' + r.id + '">Remove</button>';
                    listEl.appendChild(li);
                    li.querySelector('.marketplace-unhide-remove-rule').addEventListener('click', function () { removeMarketplaceHiddenRule(marketplaceUnhideModalItemId, r.id); });
                });
            }
        });
}

var marketplaceEditModalItemId = null;
function openMarketplaceEditModal(itemId) {
    marketplaceEditModalItemId = itemId;
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var modal = document.getElementById('marketplace-edit-item-modal');
    document.getElementById('marketplace-edit-item-name').value = item.name || '';
    document.getElementById('marketplace-edit-item-description').value = item.description || '';
    document.getElementById('marketplace-edit-item-price').value = item.price != null ? item.price : '';
    document.getElementById('marketplace-edit-item-grade-range').value = item.grade_range || '9_12';
    document.getElementById('marketplace-edit-item-image-url').value = item.image_url || '';
    document.getElementById('marketplace-edit-item-error').style.display = 'none';
    var typeSel = document.getElementById('marketplace-edit-item-type');
    var catSel = document.getElementById('marketplace-edit-item-category');
    if (typeSel && catSel) {
        Promise.all([
            fetch('/api/marketplace/types').then(function (r) { return r.ok ? r.json() : []; }),
            fetch('/api/marketplace/categories').then(function (r) { return r.ok ? r.json() : []; })
        ]).then(function (arr) {
            var types = arr[0] || [];
            var cats = arr[1] || [];
            typeSel.innerHTML = '<option value="">— None —</option>' + types.map(function (t) { return '<option value="' + t.id + '">' + (t.name || '').replace(/</g, '&lt;') + '</option>'; }).join('');
            catSel.innerHTML = '<option value="">— None —</option>' + cats.map(function (c) { return '<option value="' + c.id + '">' + (c.name || '').replace(/</g, '&lt;') + '</option>'; }).join('');
            typeSel.value = item.item_type_id || '';
            catSel.value = item.category_id || '';
        });
    }
    if (modal) modal.style.display = 'block';
}
function closeMarketplaceEditModal() {
    marketplaceEditModalItemId = null;
    var modal = document.getElementById('marketplace-edit-item-modal');
    if (modal) modal.style.display = 'none';
}
function submitMarketplaceEditItem() {
    var itemId = marketplaceEditModalItemId;
    if (!itemId) return;
    var nameIn = document.getElementById('marketplace-edit-item-name');
    var descIn = document.getElementById('marketplace-edit-item-description');
    var priceIn = document.getElementById('marketplace-edit-item-price');
    var gradeSel = document.getElementById('marketplace-edit-item-grade-range');
    var typeSel = document.getElementById('marketplace-edit-item-type');
    var catSel = document.getElementById('marketplace-edit-item-category');
    var imgIn = document.getElementById('marketplace-edit-item-image-url');
    var errEl = document.getElementById('marketplace-edit-item-error');
    var name = nameIn && nameIn.value ? nameIn.value.trim() : '';
    var price = priceIn && priceIn.value ? parseFloat(priceIn.value, 10) : NaN;
    if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
    if (!price || isNaN(price) || price <= 0) { errEl.textContent = 'Please enter a valid price.'; errEl.style.display = 'block'; return; }
    var payload = {
        name: name,
        description: (descIn && descIn.value) ? descIn.value.trim() : '',
        price: price,
        grade_range: (gradeSel && gradeSel.value) ? gradeSel.value : '9_12',
        item_type_id: (typeSel && typeSel.value) ? parseInt(typeSel.value, 10) : null,
        category_id: (catSel && catSel.value) ? parseInt(catSel.value, 10) : null,
        image_url: (imgIn && imgIn.value) ? imgIn.value.trim() : null
    };
    errEl.style.display = 'none';
    fetch('/api/marketplace-items/' + itemId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
            if (res.ok) {
                closeMarketplaceEditModal();
                var idx = marketplaceCatalog.findIndex(function (x) { return x.id === itemId; });
                if (idx >= 0 && res.data) marketplaceCatalog[idx] = Object.assign({}, marketplaceCatalog[idx], res.data);
                loadMarketplaceCatalog();
            } else {
                errEl.textContent = (res.data && res.data.error) || 'Failed to update.'; errEl.style.display = 'block';
            }
        })
        .catch(function () { errEl.textContent = 'Failed to update.'; errEl.style.display = 'block'; });
}
function confirmDeleteMarketplaceItem(itemId) {
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var delMsg = "Delete item \"" + (item.name || "").replace(/"/g, "") + "\"? This will deactivate the item.";
    if (!confirm(delMsg)) return;
    fetch('/api/marketplace-items/' + itemId, { method: 'DELETE' })
        .then(function (r) {
            if (r.ok) {
                loadMarketplaceCatalog();
            } else {
                r.json().then(function (data) { alert((data && data.error) || 'Delete failed.'); });
            }
        })
        .catch(function () { alert('Delete failed.'); });
}

function setupMarketplaceStudentSearch() {
    var searchInput = document.getElementById('marketplace-student-search-input');
    var dropdown = document.querySelector('.marketplace-student-autocomplete-dropdown');
    var managedByMe = document.getElementById('marketplace-managed-by-me-checkbox');
    if (!searchInput || !dropdown) return;
    var list = [];
    function showDropdown(items) {
        dropdown.innerHTML = '';
        dropdown.style.display = 'block';
        items.slice(0, 15).forEach(function (s) {
            var div = document.createElement('div');
            div.className = 'bank-search-autocomplete-item';
            div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
            div.textContent = s.student_name + ' ($' + (s.balance != null ? Number(s.balance).toFixed(2) : '0.00') + ')';
            div.addEventListener('mousedown', function (e) {
                e.preventDefault();
                selectMarketplaceStudent(s.student_id);
                searchInput.value = div.textContent;
                dropdown.style.display = 'none';
                // When a marketplace student search is committed, clear "managed by me" so it does not persist across searches.
                if (managedByMe && managedByMe.checked) {
                    managedByMe.checked = false;
                }
            });
            dropdown.appendChild(div);
        });
    }
    function loadList() {
        var params = new URLSearchParams();
        if (managedByMe && managedByMe.checked) params.set('managed_by_me', 'true');
        var q = searchInput.value.trim();
        if (q) params.set('q', q);
        fetch('/api/bank-account/search?' + params.toString()).then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
            list = data;
            showDropdown(list);
        });
    }
    searchInput.addEventListener('input', loadList);
    searchInput.addEventListener('focus', function () { if (list.length) showDropdown(list); else loadList(); });
    document.addEventListener('click', function (e) { if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });
    if (managedByMe) managedByMe.addEventListener('change', loadList);
}

// Bank Account student search (mirror marketplace behavior)
function setupBankStudentSearch() {
    var searchInput = document.getElementById('bank-student-search-input');
    var wrapper = searchInput && searchInput.closest('.bank-search-autocomplete-wrapper');
    var dropdown = wrapper && wrapper.querySelector('.bank-search-autocomplete-dropdown');
    var managedByMe = document.getElementById('bank-managed-by-me-checkbox');
    var noMsg = document.getElementById('bank-no-student-msg');
    if (!searchInput || !dropdown || searchInput._bankSimpleAutocompleteBound) return;
    searchInput._bankSimpleAutocompleteBound = true;

    var list = [];

    function setSectionsVisible(visible) {
        var display = visible ? 'block' : 'none';
        var balanceSection = document.getElementById('bank-balance-section');
        var paycheckSection = document.getElementById('bank-paycheck-section');
        var transactionsSection = document.getElementById('bank-transactions-section');
        if (balanceSection) balanceSection.style.display = display;
        if (paycheckSection) paycheckSection.style.display = display;
        if (transactionsSection) transactionsSection.style.display = display;
    }

    // Initial state: hide bank sections and show placeholder message until a student is selected.
    setSectionsVisible(false);
    if (noMsg) {
        noMsg.style.display = 'block';
    }

    function showDropdown(items) {
        dropdown.innerHTML = '';
        if (!items || !items.length) {
            dropdown.style.display = 'none';
            return;
        }
        dropdown.style.display = 'block';
        items.slice(0, 15).forEach(function (s) {
            var div = document.createElement('div');
            div.className = 'bank-search-autocomplete-item';
            div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
            var label = (s.student_name || '') + ' ($' + (s.balance != null ? Number(s.balance).toFixed(2) : '0.00') + ')';
            div.textContent = label;
            div.addEventListener('mousedown', function (e) {
                e.preventDefault();
                currentBankStudentId = s.student_id;
                searchInput.value = label;
                dropdown.style.display = 'none';
                if (noMsg) noMsg.style.display = 'none';
                setSectionsVisible(true);
                // When a bank-account student search is committed, clear "managed by me" so it does not persist across searches.
                if (managedByMe && managedByMe.checked) {
                    managedByMe.checked = false;
                }
                loadBankAccount(s.student_id);
            });
            dropdown.appendChild(div);
        });
    }

    function loadList() {
        var params = new URLSearchParams();
        if (managedByMe && managedByMe.checked) params.set('managed_by_me', 'true');
        var q = (searchInput.value || '').trim();
        if (q) params.set('q', q);
        fetch('/api/bank-account/search?' + params.toString())
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (data) {
                list = Array.isArray(data) ? data : [];
                showDropdown(list);
            })
            .catch(function () {
                list = [];
                dropdown.style.display = 'none';
            });
    }

    searchInput.addEventListener('input', loadList);
    searchInput.addEventListener('focus', function () {
        if (list.length) showDropdown(list);
        else loadList();
    });
    document.addEventListener('click', function (e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
    if (managedByMe) managedByMe.addEventListener('change', loadList);
}

function selectMarketplaceStudent(studentId) {
    currentMarketplaceStudentId = studentId;
    loadMarketplaceBalance();
    loadMarketplaceCatalog();
    loadMarketplaceMyOrders();
    loadMarketplaceTypesAndCategories();
}

function loadMarketplaceMyOrders() {
    var list = document.getElementById('marketplace-my-orders-list');
    if (!list) return;
    var sid = getMarketplaceStudentId();
    if (!sid && window.currentUser && window.currentUser.role !== 'student') {
        list.innerHTML = '<p style="margin:0; color:#94a3b8;">Select a student to view their orders.</p>';
        return;
    }
    fetch('/api/purchase-orders')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (orders) {
            if (sid && window.currentUser && window.currentUser.role !== 'student') {
                orders = orders.filter(function (o) { return o.student_id === sid; });
            }
            if (!orders.length) {
                list.innerHTML = '<p style="margin:0; color:#94a3b8;">No orders yet.</p>';
                return;
            }
            list.innerHTML = orders.map(function (o) {
                var statusColor = o.status === 'approved' ? '#059669' : o.status === 'denied' ? '#dc2626' : '#64748b';
                var statusLabel = o.status === 'approved' ? 'fulfilled' : (o.status || '');
                return '<div style="padding:10px 0; border-bottom:1px solid #f1f5f9;">' +
                    '<span style="font-weight:600;">' + (o.item_name || '').replace(/</g, '&lt;') + '</span> — $' + Number(o.item_price).toFixed(2) +
                    ' <span style="color:' + statusColor + ';">(' + statusLabel + ')</span>' +
                    (o.approved_by_name ? ' — Fulfilled by ' + o.approved_by_name.replace(/</g, '&lt;') : '') +
                    (o.denial_reason ? ' — ' + o.denial_reason.replace(/</g, '&lt;') : '') +
                    '</div>';
            }).join('');
        })
        .catch(function () {
            list.innerHTML = '<p style="margin:0; color:#dc2626;">Failed to load orders.</p>';
        });
}

function bindMarketplaceCheckout() {
    var btn = document.getElementById('marketplace-checkout-btn');
    var msg = document.getElementById('marketplace-checkout-msg');
    if (!btn || btn._marketplaceBound) return;
    btn._marketplaceBound = true;
    btn.addEventListener('click', function () {
        if (!marketplaceCart.length) return;
        var sid = getMarketplaceStudentId();
        if (!sid) { if (msg) { msg.style.display = 'block'; msg.textContent = 'Select a student first.'; msg.style.color = '#dc2626'; } return; }
        var cart = marketplaceCart.map(function (x) { return { item_id: x.item_id, quantity: x.quantity || 1 }; });
        fetch('/api/marketplace/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart: cart })
        })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
                if (res.ok) {
                    marketplaceCart = [];
                    saveMarketplaceCartToStorage();
                    renderMarketplaceCart();
                    loadMarketplaceBalance();
                    loadMarketplaceMyOrders();
                    if (msg) { msg.style.display = 'block'; msg.textContent = 'Purchase orders submitted. Your support team will review them.'; msg.style.color = '#059669'; }
                } else {
                    if (msg) { msg.style.display = 'block'; msg.textContent = res.data.error || 'Checkout failed'; msg.style.color = '#dc2626'; }
                }
            })
            .catch(function () {
                if (msg) { msg.style.display = 'block'; msg.textContent = 'Checkout failed'; msg.style.color = '#dc2626'; }
            });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    var refreshBtn = document.getElementById('marketplace-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
        loadMarketplaceBalance();
        if (getMarketplaceStudentId()) loadMarketplaceCatalog();
    });
    var searchBtn = document.getElementById('marketplace-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', function () {
        loadMarketplaceCatalog();
    });
    var addItemBtn = document.getElementById('marketplace-add-item-btn');
    if (addItemBtn && !addItemBtn._marketplaceAddBound) {
        addItemBtn._marketplaceAddBound = true;
        addItemBtn.addEventListener('click', openMarketplaceAddItemModal);
    }
    var addItemSubmit = document.getElementById('marketplace-add-item-submit');
    if (addItemSubmit && !addItemSubmit._marketplaceAddBound) {
        addItemSubmit._marketplaceAddBound = true;
        addItemSubmit.addEventListener('click', submitMarketplaceAddItem);
    }
    bindMarketplaceItemDetailModal();
    (function bindMarketplaceHideUnhideEditModals() {
        var hideClose = document.getElementById('marketplace-hide-modal-close');
        var hideCancel = document.getElementById('marketplace-hide-cancel');
        var hideSubmit = document.getElementById('marketplace-hide-submit');
        var hideModal = document.getElementById('marketplace-hide-modal');
        if (hideClose) hideClose.addEventListener('click', closeMarketplaceHideModal);
        if (hideCancel) hideCancel.addEventListener('click', closeMarketplaceHideModal);
        if (hideSubmit) hideSubmit.addEventListener('click', submitMarketplaceHide);
        if (hideModal) hideModal.addEventListener('click', function (e) { if (e.target === hideModal) closeMarketplaceHideModal(); });
        var hideTypeRadios = document.querySelectorAll('input[name="marketplace-hide-type"]');
        var hideValueStudent = document.getElementById('marketplace-hide-value-student');
        var hideValueColor = document.getElementById('marketplace-hide-value-color');
        var hideValueGrade = document.getElementById('marketplace-hide-value-grade');
        hideTypeRadios.forEach(function (r) {
            r.addEventListener('change', function () {
                var t = this.value;
                if (hideValueStudent) hideValueStudent.style.display = (t === 'student') ? 'block' : 'none';
                if (hideValueColor) hideValueColor.style.display = (t === 'card_color') ? 'block' : 'none';
                if (hideValueGrade) hideValueGrade.style.display = (t === 'grade_section') ? 'block' : 'none';
            });
        });
        var hideStudentSearch = document.getElementById('marketplace-hide-student-search');
        var hideStudentDropdown = document.getElementById('marketplace-hide-student-dropdown');
        var hideStudentId = document.getElementById('marketplace-hide-student-id');
        if (hideStudentSearch && hideStudentDropdown && hideStudentId) {
            var hideStudentList = [];
            function showHideStudentDropdown(items) {
                hideStudentDropdown.innerHTML = '';
                hideStudentDropdown.style.display = 'block';
                (items || []).slice(0, 15).forEach(function (s) {
                    var div = document.createElement('div');
                    div.className = 'bank-search-autocomplete-item';
                    div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
                    div.textContent = (s.student_name || s.name || '') + (s.balance != null ? ' ($' + Number(s.balance).toFixed(2) + ')' : '');
                    div.addEventListener('mousedown', function (e) {
                        e.preventDefault();
                        var sid = s.student_id != null ? s.student_id : s.id;
                        hideStudentId.value = String(sid);
                        hideStudentSearch.value = s.student_name || s.name || '';
                        hideStudentDropdown.style.display = 'none';
                    });
                    hideStudentDropdown.appendChild(div);
                });
            }
            hideStudentSearch.addEventListener('input', function () {
                var q = hideStudentSearch.value.trim();
                hideStudentId.value = '';
                if (!q) { hideStudentDropdown.style.display = 'none'; return; }
                var params = new URLSearchParams({ q: q });
                fetch('/api/bank-account/search?' + params.toString()).then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
                    hideStudentList = data;
                    showHideStudentDropdown(data);
                });
            });
            hideStudentSearch.addEventListener('focus', function () {
                if (hideStudentList.length) showHideStudentDropdown(hideStudentList);
                else if (hideStudentSearch.value.trim()) hideStudentSearch.dispatchEvent(new Event('input'));
            });
            document.addEventListener('click', function (e) {
                if (!hideStudentSearch.contains(e.target) && !hideStudentDropdown.contains(e.target)) hideStudentDropdown.style.display = 'none';
            });
        }
        var unhideClose = document.getElementById('marketplace-unhide-modal-close');
        var unhideCloseBtn = document.getElementById('marketplace-unhide-close-btn');
        var unhideAddMore = document.getElementById('marketplace-unhide-add-more');
        var unhideModal = document.getElementById('marketplace-unhide-modal');
        if (unhideClose) unhideClose.addEventListener('click', closeMarketplaceUnhideModal);
        if (unhideCloseBtn) unhideCloseBtn.addEventListener('click', closeMarketplaceUnhideModal);
        if (unhideModal) unhideModal.addEventListener('click', function (e) { if (e.target === unhideModal) closeMarketplaceUnhideModal(); });
        if (unhideAddMore) unhideAddMore.addEventListener('click', function () {
            if (marketplaceUnhideModalItemId != null) {
                closeMarketplaceUnhideModal();
                openMarketplaceHideModal(marketplaceUnhideModalItemId);
            }
        });
        var editClose = document.getElementById('marketplace-edit-item-modal-close');
        var editCancel = document.getElementById('marketplace-edit-item-cancel');
        var editSubmit = document.getElementById('marketplace-edit-item-submit');
        var editModal = document.getElementById('marketplace-edit-item-modal');
        if (editClose) editClose.addEventListener('click', closeMarketplaceEditModal);
        if (editCancel) editCancel.addEventListener('click', closeMarketplaceEditModal);
        if (editSubmit) editSubmit.addEventListener('click', submitMarketplaceEditItem);
        if (editModal) editModal.addEventListener('click', function (e) { if (e.target === editModal) closeMarketplaceEditModal(); });
    })();
    var viewAsCheck = document.getElementById('marketplace-show-view-as-student-checkbox');
    var studentWrap = document.getElementById('marketplace-student-select-wrap');
    var balanceSection = document.getElementById('marketplace-balance-section');
    var cartSection = document.getElementById('marketplace-cart-section');
    if (viewAsCheck && !viewAsCheck._viewAsBound) {
        viewAsCheck._viewAsBound = true;
        viewAsCheck.addEventListener('change', function () {
            if (studentWrap) studentWrap.style.display = viewAsCheck.checked ? 'block' : 'none';
            if (balanceSection) balanceSection.style.display = viewAsCheck.checked ? 'block' : 'none';
            if (cartSection) cartSection.style.display = viewAsCheck.checked ? 'block' : 'none';
            if (!viewAsCheck.checked) {
                currentMarketplaceStudentId = null;
                if (document.getElementById('marketplace-balance-amount')) document.getElementById('marketplace-balance-amount').textContent = '$0.00';
                if (document.getElementById('marketplace-student-name')) document.getElementById('marketplace-student-name').textContent = '';
            } else if (currentMarketplaceStudentId) {
                loadMarketplaceBalance();
                loadMarketplaceCatalog();
                loadMarketplaceMyOrders();
            }
        });
    }
    var imageUrlInfoBtn = document.getElementById('marketplace-add-item-image-url-info-btn');
    var imageUrlInfoPopover = document.getElementById('marketplace-add-item-image-url-info');
    var imageUrlInfoWrap = imageUrlInfoBtn && imageUrlInfoBtn.closest('.marketplace-image-url-info-wrap');
    if (imageUrlInfoBtn && imageUrlInfoPopover && imageUrlInfoWrap && !imageUrlInfoBtn._imageUrlInfoBound) {
        imageUrlInfoBtn._imageUrlInfoBound = true;
        var imageUrlInfoPinned = false;
        function showImageUrlInfo() {
            imageUrlInfoPopover.classList.add('is-visible');
        }
        function hideImageUrlInfo() {
            if (!imageUrlInfoPinned) imageUrlInfoPopover.classList.remove('is-visible');
        }
        function toggleImageUrlInfo() {
            imageUrlInfoPinned = !imageUrlInfoPinned;
            if (imageUrlInfoPinned) showImageUrlInfo(); else hideImageUrlInfo();
        }
        imageUrlInfoWrap.addEventListener('mouseenter', showImageUrlInfo);
        imageUrlInfoWrap.addEventListener('mouseleave', hideImageUrlInfo);
        imageUrlInfoBtn.addEventListener('click', function (e) {
            e.preventDefault();
            toggleImageUrlInfo();
        });
        document.addEventListener('click', function (e) {
            if (!imageUrlInfoPinned) return;
            if (imageUrlInfoWrap.contains(e.target)) return;
            imageUrlInfoPinned = false;
            hideImageUrlInfo();
        });
    }
    loadMarketplaceTypesAndCategories();
    var analyticsItemSelect = document.getElementById('marketplace-analytics-item-select');
    if (analyticsItemSelect && !analyticsItemSelect._analyticsBound) {
        analyticsItemSelect._analyticsBound = true;
        analyticsItemSelect.addEventListener('change', function () {
            var v = this.value;
            renderMarketplaceAnalyticsDemographics(v ? parseInt(v, 10) : null);
        });
    }
    var analyticsHideCheck = document.getElementById('marketplace-analytics-hide-checkbox');
    var analyticsBody = document.getElementById('marketplace-analytics-body');
    if (analyticsHideCheck && analyticsBody && !analyticsHideCheck._hideBound) {
        analyticsHideCheck._hideBound = true;
        function toggleAnalyticsVisible() {
            analyticsBody.style.display = analyticsHideCheck.checked ? 'none' : 'block';
        }
        analyticsHideCheck.addEventListener('change', toggleAnalyticsVisible);
        toggleAnalyticsVisible();
    }
});
window.closeMarketplaceAnalytics = destroyMarketplaceAnalyticsCharts;
window.closeMarketplaceAddItemModal = closeMarketplaceAddItemModal;
