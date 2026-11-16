const s = require('../shared');
const ui = require('../../utils/ui');
const labels = { pending: '待认领', claimed: '待审核', approved: '已批准', rejected: '已拒绝', revoked: '已撤销', expired: '已过期' };
let serial = 0;
function view(row) {
  if (!row || typeof row.id !== 'string' || !Number.isSafeInteger(row.revision)) throw Error('邀请资料不完整，请重新载入');
  return { id: row.id, revision: row.revision, status: row.status, label: labels[row.status] || '状态待核对', expiresAt: row.expiresAt, expires: Number.isFinite(row.expiresAt) ? new Date(row.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '—' };
}
module.exports = {
  data: { loading: true, error: '', enabled: false, authorized: false, busy: false, loadingMore: false, actionError: '', playerName: '', archived: false, unconfirmed: false, binding: null, activeInvite: null, items: [], hasMore: false, canCopy: false, needsRefresh: false, cardPath: '', cardOpen: false },
  onLoad(q) { this.id = typeof q?.id === 'string' ? q.id : ''; },
  onShow() { this._hidden = false; this._disposed = false; return this.refresh(); },
  onHide() { this.invalidate(); },
  onUnload() { this.invalidate(); this._disposed = true; },
  invalidate() {
    ui.abort(this); this._hidden = true; this._turn = (this._turn || 0) + 1;
    this._credential = null;
    this.setData({ canCopy: false, authorized: false, loading: true, busy: false, loadingMore: false, activeInvite: null, items: [], binding: null, playerName: '', actionError: '', cardPath: '', cardOpen: false });
  },
  stamp() { return { turn: this._turn, token: s.api.getSession()?.token }; },
  current(stamp) { return !this._disposed && !this._hidden && stamp.turn === this._turn && !!stamp.token && stamp.token === s.api.getSession()?.token; },
  ready() { return !this._disposed && !this._hidden && !this.data.businessUiBlocking && this.data.authorized && this.data.enabled && !this.data.loading && !this.data.error && !this.data.busy && !this.data.loadingMore && !this.data.needsRefresh && s.api.getSession()?.token === this._owner; },
  apiPath(tail) { return '/players/' + encodeURIComponent(this.id) + '/wechat-' + tail; },
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
      const binding = await s.api.request(this.apiPath('binding'));
      const list = player.status === 'active' ? await s.api.request(this.apiPath('invites')) : { items: [], activeInvite: null, nextCursor: null };
      if (!this.current(stamp)) return;
      const activeInvite = list.activeInvite ? view(list.activeInvite) : null;
      if (!activeInvite || this._credential?.id !== activeInvite.id || activeInvite.status !== 'pending') this._credential = null;
      this._cursor = list.nextCursor || null;
      this.setData({ enabled: true, authorized: true, playerName: player.name, archived: player.membershipConfirmed !== false && player.status !== 'active', unconfirmed: player.membershipConfirmed === false, binding: { bound: binding.bound === true, revision: binding.revision, passwordEnabled: binding.passwordEnabled === true }, activeInvite, items: list.items.map(view), hasMore: !!this._cursor, canCopy: !!this._credential, cardPath: this._credential ? this.data.cardPath : '', needsRefresh: false });
    } catch (error) {
      if (turn === this._turn && !this._hidden && !this._disposed) { this._credential = null; this.setData({ error: error.message || '暂时无法加载', canCopy: false }); }
    } finally { if (turn === this._turn && !this._hidden && !this._disposed) this.setData({ loading: false }); }
  },
  async more() {
    if (!this.ready() || !this._cursor) return;
    const stamp = this.stamp(), cursor = this._cursor;
    this.setData({ loadingMore: true, actionError: '' });
    try {
      const list = await s.api.request(this.apiPath('invites') + '?cursor=' + encodeURIComponent(cursor));
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
  async create() {
    if (!this.ready() || this.data.archived || this.data.unconfirmed || this.data.binding?.bound || this.data.activeInvite?.status === 'claimed') return;
    if (this._credential && this.data.activeInvite?.id === this._credential.id && this.data.activeInvite.expiresAt > Date.now()) return this.generateCard();
    const stamp = this.stamp(), previous = this.data.activeInvite;
    this.setData({ busy: true, actionError: '', cardOpen: false, cardPath: '' });
    try {
      if (previous?.status === 'pending') {
        await s.api.request(this.apiPath('invites') + '/' + previous.id + '/revoke', 'POST', { revision: previous.revision });
        if (!this.current(stamp)) return;
        this._createId = null;
      }
      this._credential = null;
      this._createId ||= 'invite-' + Date.now() + '-' + ++serial + '-' + Math.random().toString(36).slice(2);
      const result = await s.api.request(this.apiPath('invites'), 'POST', { requestId: this._createId });
      if (!this.current(stamp)) return;
      this._createId = null;
      if (!/^[a-f0-9]{64}$/.test(result.credential || '')) throw Error('邀请凭据无法取得');
      this._credential = { id: result.id, value: result.credential };
      this.setData({ busy: false });
      await this.refresh();
      if (!this.current({ turn: stamp.turn + 1, token: stamp.token }) || this.data.error || !this._credential) return;
      await this.generateCard();
    } catch (e) {
      if (this.current(stamp)) this.setData({ busy: false, needsRefresh: true, actionError: (e.message || '邀请结果未确认') + '，请重新载入后重试。' });
    }
  },
  editPlayer() {
    if (!this.data.busy && this.id) wx.navigateTo({ url: '/pages/manage-player/index?id=' + encodeURIComponent(this.id) });
  },
  copy() {
    if (!this.ready() || !this._credential || !this.data.canCopy) return;
    const stamp = this.stamp(), secret = this._credential;
    return ui.showModal(this, { title: '复制邀请凭据', content: '仅通过可信渠道交给这名球员本人。复制后由你自行发送，不会自动发消息。', confirmText: '复制', success: r => {
      if (!r.confirm || !this.current(stamp) || !this.ready() || this._credential !== secret) return;
      wx.setClipboardData({ data: secret.value, success: () => { if (this.current(stamp)) ui.showToast(this, { title: '已复制，请仅交给本人' }); }, fail: () => { if (this.current(stamp)) this.setData({ actionError: '复制失败，请重试' }); } });
    } });
  },
  async generateCard() {
    if (!this.ready() || !this._credential || !this.data.canCopy) return;
    if (!this.data.activeInvite || this.data.activeInvite.expiresAt <= Date.now()) { this.setData({ actionError: '邀请已过期，请重新载入并创建新邀请。' }); return; }
    const stamp = this.stamp(), secret = this._credential, invite = this.data.activeInvite;
    this.setData({ busy: true, actionError: '', cardPath: '' });
    try {
      const result = await s.api.request(this.apiPath('invites') + '/' + invite.id + '/code', 'POST', { credential: secret.value });
      if (!this.current(stamp) || this._credential !== secret) return;
      if (!/^data:image\/(png|jpeg);base64,/.test(result.image || '')) throw Error('小程序码响应无效');
      const canvas = await new Promise((resolve, reject) => wx.createSelectorQuery().in(this).select('#invite-card-canvas').fields({node:true,size:true}).exec(rows => rows?.[0]?.node ? resolve(rows[0].node) : reject(Error('无法创建邀请卡片'))));
      if (!this.current(stamp) || this._credential !== secret) return;
      const image = canvas.createImage();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('小程序码加载失败')); image.src = result.image; });
      if (!this.current(stamp) || this._credential !== secret) return;
      canvas.width = 750; canvas.height = 1050;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f8f5fa'; ctx.fillRect(0,0,750,1050);
      ctx.fillStyle = '#8845a0'; ctx.fillRect(0,0,750,265);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('球队邀请',50,90);
      ctx.font = '32px sans-serif'; ctx.fillText(Array.from(s.api.getSession()?.team?.name || '球队').slice(0, 18).join(''),50,160);
      ctx.fillStyle = '#2d2634'; ctx.font = 'bold 44px sans-serif';
      const name = Array.from(this.data.playerName).slice(0, 12).join('');
      ctx.fillText(`邀请 ${name} 加入`,50,345);
      ctx.font = '30px sans-serif'; ctx.fillStyle = '#716579';
      ctx.fillText('请使用微信扫码，提交本人认领申请',50,410);
      ctx.fillText('管理员核对后即可加入球队',50,457);
      ctx.drawImage(image, 160, 480, 430, 430);
      ctx.font = '26px sans-serif'; ctx.fillStyle = '#716579';
      ctx.fillText('仅限本人使用 · 24 小时内有效', 170, 970);
      const cardPath = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, width:750,height:1050,destWidth:750,destHeight:1050,fileType:'png',success:r=>resolve(r.tempFilePath),fail:()=>reject(Error('邀请卡片生成失败')) }, this));
      if (this.current(stamp) && this._credential === secret) this.setData({ cardPath, cardOpen: true });
    } catch (e) { if (this.current(stamp)) this.setData({ actionError: e.message || '生成邀请卡片失败，请重试' }); }
    finally { if (this.current(stamp)) this.setData({ busy: false }); }
  },
  closeCard() { this.setData({ cardOpen: false }); },
  stopCardTap() {},
  shareCard() {
    if (!this.ready() || !this.data.cardPath || !this._credential) return;
    if (!this.data.activeInvite || this.data.activeInvite.expiresAt <= Date.now()) { this.setData({ actionError: '邀请已过期，请重新载入并创建新邀请。', cardPath: '' }); return; }
    if (typeof wx.showShareImageMenu !== 'function') { this.setData({ actionError: '当前微信版本不支持转发图片，请更新微信。' }); return; }
    wx.showShareImageMenu({ path: this.data.cardPath, fail: () => { if (!this._hidden && !this._disposed) this.setData({ actionError: '转发未完成，请重试。' }); } });
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
      return this.mutate(this.apiPath('invites') + '/' + invite.id + '/' + action, body, () => { this._credential = null; this._createId = null; });
    } });
  },
  unbind() {
    if (!this.ready() || !this.data.binding?.bound) return;
    const stamp = this.stamp(), revision = this.data.binding.revision;
    return ui.showModal(this, { title: '解除微信绑定', content: '将使该球员退出登录并撤销待处理邀请。' + (this.data.binding.passwordEnabled ? '原账号密码能力保留。' : '该球员需重新邀请绑定后才能登录。'), confirmText: '确认解绑', danger: true, success: r => {
      if (r.confirm && this.current(stamp) && this.ready() && revision === this.data.binding?.revision) return this.mutate(this.apiPath('binding/revoke'), { revision }, () => { this._credential = null; this._createId = null; });
    } });
  }
};
