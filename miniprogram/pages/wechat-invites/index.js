const s = require('../shared');
const ui = require('../../utils/ui');
const labels = { pending: '待认领', claimed: '待审核', approved: '已批准', rejected: '已拒绝', revoked: '已撤销', expired: '已过期' };
let serial = 0;
function view(row) {
  if (!row || typeof row.id !== 'string' || !Number.isSafeInteger(row.revision)) throw Error('邀请资料不完整，请重新载入');
  return { id: row.id, revision: row.revision, status: row.status, label: labels[row.status] || '状态待核对', expires: Number.isFinite(row.expiresAt) ? new Date(row.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '—' };
}
Page({
  data: { loading: true, error: '', enabled: false, authorized: false, busy: false, loadingMore: false, actionError: '', playerName: '', archived: false, binding: null, activeInvite: null, items: [], hasMore: false, canCopy: false, needsRefresh: false },
  onLoad(q) { this.id = typeof q?.id === 'string' ? q.id : ''; },
  onShow() { this._hidden = false; this._disposed = false; return this.refresh(); },
  onHide() { this.invalidate(); },
  onUnload() { this.invalidate(); this._disposed = true; },
  invalidate() {
    ui.abort(this); this._hidden = true; this._turn = (this._turn || 0) + 1;
    this._credential = null;
    this.setData({ canCopy: false, authorized: false, loading: true, busy: false, loadingMore: false, activeInvite: null, items: [], binding: null, playerName: '', actionError: '' });
  },
  stamp() { return { turn: this._turn, token: s.api.getSession()?.token }; },
  current(stamp) { return !this._disposed && !this._hidden && stamp.turn === this._turn && !!stamp.token && stamp.token === s.api.getSession()?.token; },
  ready() { return !this._disposed && !this._hidden && !this.data.businessUiBlocking && this.data.authorized && this.data.enabled && !this.data.loading && !this.data.error && !this.data.busy && !this.data.loadingMore && !this.data.needsRefresh && s.api.getSession()?.token === this._owner; },
  route(tail) { return '/players/' + encodeURIComponent(this.id) + '/wechat-' + tail; },
  async refresh() {
    if (this._hidden || this.data.busy || this.data.loadingMore) return;
    this._turn = (this._turn || 0) + 1;
    const turn = this._turn;
    this.setData({ loading: true, error: '', actionError: '', authorized: false });
    try {
      const session = await s.api.ensureSession();
      const stored = s.api.getSession();
      const stamp = { turn, token: stored?.token };
      if (!stored || stored.user?.id !== session.user?.id || stored.team?.id !== session.team?.id) throw Error('登录身份已变化，请重新载入');
      if (!this.current(stamp)) return;
      if (session.user.role !== 'admin') throw Error('仅管理员可以管理微信邀请');
      if (!this.id) throw Error('缺少球员编号');
      if (this._owner !== stamp.token) { this._credential = null; this._createId = null; }
      this._owner = stamp.token;
      const capability = await s.api.capabilities();
      if (!this.current(stamp)) return;
      if (!capability.wechat) { this._credential = null; this.setData({ enabled: false, authorized: true, canCopy: false, items: [], activeInvite: null, binding: null }); return; }
      const players = await s.api.request('/players');
      const player = players.find(p => p.id === this.id);
      if (!player) throw Error('球员不存在或不可访问');
      const binding = await s.api.request(this.route('binding'));
      const list = player.status === 'active' ? await s.api.request(this.route('invites')) : { items: [], activeInvite: null, nextCursor: null };
      if (!this.current(stamp)) return;
      const activeInvite = list.activeInvite ? view(list.activeInvite) : null;
      if (!activeInvite || this._credential?.id !== activeInvite.id || activeInvite.status !== 'pending') this._credential = null;
      this._cursor = list.nextCursor || null;
      this.setData({ enabled: true, authorized: true, playerName: player.name, archived: player.status !== 'active', binding: { bound: binding.bound === true, revision: binding.revision, passwordEnabled: binding.passwordEnabled === true }, activeInvite, items: list.items.map(view), hasMore: !!this._cursor, canCopy: !!this._credential, needsRefresh: false });
    } catch (error) {
      if (turn === this._turn && !this._hidden && !this._disposed) { this._credential = null; this.setData({ error: error.message || '暂时无法加载', canCopy: false }); }
    } finally { if (turn === this._turn && !this._hidden && !this._disposed) this.setData({ loading: false }); }
  },
  async more() {
    if (!this.ready() || !this._cursor) return;
    const stamp = this.stamp(), cursor = this._cursor;
    this.setData({ loadingMore: true, actionError: '' });
    try {
      const list = await s.api.request(this.route('invites') + '?cursor=' + encodeURIComponent(cursor));
      if (!this.current(stamp)) return;
      const byId = new Map(this.data.items.map(x => [x.id, x]));
      list.items.map(view).forEach(x => byId.set(x.id, x));
      const activeInvite = list.activeInvite ? view(list.activeInvite) : null;
      if (!activeInvite || this._credential?.id !== activeInvite.id || activeInvite.status !== 'pending') this._credential = null;
      this._cursor = list.nextCursor || null;
      this.setData({ items: [...byId.values()], activeInvite, hasMore: !!this._cursor, canCopy: !!this._credential });
    } catch (e) { if (this.current(stamp)) this.setData({ actionError: e.message || '加载失败，请重试' }); }
    finally { if (this.current(stamp)) this.setData({ loadingMore: false }); }
  },
  async mutate(path, body, capture) {
    if (!this.ready()) return;
    const stamp = this.stamp(); this.setData({ busy: true, actionError: '' });
    try {
      const result = await s.api.request(path, 'POST', body);
      if (!this.current(stamp)) return;
      const notice = capture?.(result); this.setData({ busy: false });
      await this.refresh();
      if (notice && this.current({ turn: stamp.turn + 1, token: stamp.token }) && !this.data.error) this.setData({ actionError: notice });
    } catch (e) {
      if (this.current(stamp)) this.setData({ busy: false, needsRefresh: true, actionError: (e.message || '操作结果未确认') + '，请先重新载入核对，勿重复操作。' });
    }
  },
  create() {
    if (!this.ready() || this.data.archived || this.data.binding?.bound || this.data.activeInvite) return;
    const stamp = this.stamp();
    return ui.showModal(this, { title: '创建微信邀请', content: '为“' + this.data.playerName + '”创建 24 小时有效邀请。仅交给本人，认领后仍需管理员核对身份。', confirmText: '创建邀请', success: r => {
      if (!r.confirm || !this.current(stamp) || !this.ready()) return;
      this._createId ||= 'invite-' + Date.now() + '-' + ++serial + '-' + Math.random().toString(36).slice(2);
      return this.mutate(this.route('invites'), { requestId: this._createId }, result => {
        this._createId = null;
        this._credential = /^[a-f0-9]{64}$/.test(result.credential || '') ? { id: result.id, value: result.credential } : null;
        if (result.credentialUnavailable) return ['pending', 'claimed'].includes(result.status)
          ? '原邀请已存在，凭据无法再次显示。如尚未交付，请核对后撤销重建。'
          : '已核对上次邀请（' + (labels[result.status] || '状态待核对') + '），本次未新建。请核对当前绑定状态，如需重新邀请，请再次主动创建。';
      });
    } });
  },
  copy() {
    if (!this.ready() || !this._credential || !this.data.canCopy) return;
    const stamp = this.stamp(), secret = this._credential;
    return ui.showModal(this, { title: '复制邀请凭据', content: '仅通过可信渠道交给这名球员本人。复制后由你自行发送，不会自动发消息。', confirmText: '复制', success: r => {
      if (!r.confirm || !this.current(stamp) || !this.ready() || this._credential !== secret) return;
      wx.setClipboardData({ data: secret.value, success: () => { if (this.current(stamp)) ui.showToast(this, { title: '已复制，请仅交给本人' }); }, fail: () => { if (this.current(stamp)) this.setData({ actionError: '复制失败，请重试' }); } });
    } });
  },
  decide(e) {
    if (!this.ready()) return;
    const action = e.currentTarget.dataset.action, invite = this.data.activeInvite;
    if (!invite || !['approve', 'reject', 'revoke'].includes(action) || (action !== 'revoke' && invite.status !== 'claimed')) return;
    const stamp = this.stamp();
    return ui.showModal(this, { title: { approve: '核对本人后批准', reject: '拒绝认领申请', revoke: '撤销邀请' }[action], content: action === 'approve' ? '请通过可信联系渠道确认是该球员本人，并输入对方提供的 8 位核验编号。' : '此操作不会删除球员或比赛资料。', editable: action === 'approve', maxlength: 8, placeholderText: '本人提供的 8 位编号', confirmText: { approve: '核对并批准', reject: '拒绝申请', revoke: '撤销邀请' }[action], success: r => {
      if (!r.confirm || !this.current(stamp) || !this.ready() || this.data.activeInvite?.id !== invite.id || this.data.activeInvite?.revision !== invite.revision) return;
      const body = { revision: invite.revision };
      if (action === 'approve') {
        body.confirmationCode = String(r.content || '').trim().toUpperCase();
        if (!/^[A-F0-9]{8}$/.test(body.confirmationCode)) { this.setData({ actionError: '请输入本人提供的 8 位核验编号' }); return; }
      }
      return this.mutate(this.route('invites') + '/' + invite.id + '/' + action, body, () => { this._credential = null; this._createId = null; });
    } });
  },
  unbind() {
    if (!this.ready() || !this.data.binding?.bound) return;
    const stamp = this.stamp(), revision = this.data.binding.revision;
    return ui.showModal(this, { title: '解除微信绑定', content: '将使该球员退出登录并撤销待处理邀请。' + (this.data.binding.passwordEnabled ? '原账号密码能力保留。' : '该球员需重新邀请绑定后才能登录。'), confirmText: '确认解绑', danger: true, success: r => {
      if (r.confirm && this.current(stamp) && this.ready() && revision === this.data.binding?.revision) return this.mutate(this.route('binding/revoke'), { revision }, () => { this._credential = null; this._createId = null; });
    } });
  }
});
