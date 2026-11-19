const a = require('../manage-team/admin');
const { s } = a;
const ui = require('../../utils/ui');
const TYPES = {
  competition: { title: '赛事', path: '/competitions' },
  opponent: { title: '对手', path: '/opponents' },
  notice: { title: '比赛须知模板', path: '/notice-templates' },
};
const inFlight = new Set();
const blank = () => ({ name: '', title: '', introduction: '', playerSummary: '', content: '', status: 'active' });
Page({
  data: { loading: true, error: '', authorized: false, busy: false, conflict: false, uncertain: false, actionError: '', type: '', title: '', visible: [], search: '', editor: false, inline: false, editing: false, form: blank(), logo: '' },
  onLoad(q) {
    this.kind = Object.hasOwn(TYPES, q.type) ? q.type : null;
    if (!this.kind) { this.setData({ loading: false, error: '管理类别无效，请返回重试' }); return; }
    this.config = TYPES[this.kind];
    this._returnToOpener = q.mode === 'create';
    this.setData({ type: this.kind, title: this.config.title, inline: q.mode === 'create', editor: q.mode === 'create' });
    wx.setNavigationBarTitle({ title: this.config.title + '管理' });
    this.refresh();
  },
  onShow() { if (this.kind) return a.show.call(this); },
  onHide: a.hide,
  onUnload() { ui.abort(this); a.unload.call(this); },
  onPullDownRefresh() { if (!this.data.editor) return this.refresh(); wx.stopPullDownRefresh(); },
  guardKey() {
    const session = s.api.getSession();
    if (!session?.serverOrigin || !Number.isSafeInteger(session.user?.id) || !Number.isSafeInteger(session.team?.id)) throw Error('无法确认账号，请重新登录');
    return 'football.native.catalog-create.v1:' + encodeURIComponent(session.serverOrigin) + ':' + session.user.id + ':' + session.team.id + ':' + this.kind;
  },
  refresh() {
    if (!this.kind || this.data.busy) return;
    const turn = this._catalogLoad = {};
    const owner = s.api.getSession()?.token;
    return a.load(this, async () => {
      const rows = await s.api.request(this.config.path);
      if (turn !== this._catalogLoad || owner !== s.api.getSession()?.token || this._hidden || this._disposed) return {};
      this._rows = rows;
      this._guardKey = this.guardKey();
      const uncertain = !!wx.getStorageSync(this._guardKey);
      // Never show an old account's form on identity changes or explicit reload.
      this.id = null;
      this._imageData = undefined;
      return { visible: this.filter(rows), editor: this.data.inline, editing: false, form: blank(), logo: '', conflict: false, uncertain, actionError: uncertain ? '上次新增结果待核对，请先查看列表，勿重复提交。' : '' };
    });
  },
  project(rows) { return rows.map(r => ({ id: r.id, label: r.name || r.title, status: r.status, summary: String(r.introduction || r.content || '').slice(0, 160), logo: s.assetUrl(r.logo) })); },
  filter(rows = this._rows || []) {
    const term = this.data.search.trim().toLowerCase();
    return this.project(rows.filter(r => [r.name, r.title, r.introduction, r.playerSummary, r.content].some(v => String(v || '').toLowerCase().includes(term))));
  },
  ready() { return !this._hidden && !this._disposed && !this.data.loading && !this.data.error && !this.data.busy && this.data.authorized && this._ownerToken === s.api.getSession()?.token; },
  search(e) { if (!this.ready()) return; this.setData({ search: e.detail.value }); this.setData({ visible: this.filter() }); },
  create() {
    if (!this.ready()) return;
    this.id = null; this._imageData = undefined;
    this.setData({ editor: true, editing: false, form: blank(), logo: '', conflict: false, actionError: this.data.uncertain ? '请先核对上次新增结果' : '' });
  },
  edit(e) {
    if (!this.ready()) return;
    const row = (this._rows || []).find(r => String(r.id) === String(e.currentTarget.dataset.id));
    if (!row) return;
    this.id = row.id; this.revision = row.revision; this._imageData = undefined;
    this.setData({ editor: true, editing: true, form: { ...blank(), ...Object.fromEntries(Object.keys(blank()).filter(k => row[k] !== undefined).map(k => [k, row[k]])) }, logo: s.assetUrl(row.logo), conflict: false, actionError: '' });
  },
  input(e) { if (this.ready()) a.input.call(this, e); },
  chooseLogo() { if (this.ready() && this.kind !== 'notice') a.choosePicture(this, 'logo'); },
  clearLogo() { if (!this.ready()) return; this._imageEpoch = (this._imageEpoch || 0) + 1; this._imageData = null; this.setData({ logo: '' }); },
  imageError() { this.setData({ logo: '' }); },
  list() {
    if (!this.ready()) return;
    ui.showModal(this, { title: '返回列表', content: '未保存修改将丢弃，是否返回？', success: r => { if (r.confirm && this.ready()) { this.setData({ inline: false }); this.refresh(); } } });
  },
  reload() { if (this.ready()) a.reload(this); },
  recover(e) {
    if (!this.ready() || !this.data.uncertain || this.data.editor) return;
    const key = this._guardKey, marker = wx.getStorageSync(key), owner = this._ownerToken;
    if (inFlight.has(key)) { this.setData({ actionError: '上次请求仍在处理中，请稍后核对' }); return; }
    ui.showModal(this, { title: '确认已核对列表', content: '确认已检查上次新增结果？仅解除提醒，不会新增或删除记录。', success: r => {
      if (!r.confirm || inFlight.has(key) || !this.ready() || owner !== this._ownerToken || key !== this.guardKey() || wx.getStorageSync(key) !== marker) return;
      try { wx.removeStorageSync(key); if (wx.getStorageSync(key)) throw Error('无法清除提醒，请重试'); this.setData({ uncertain: false, actionError: '' }); } catch (error) { this.setData({ actionError: error.message }); }
    } });
  },
  async save() {
    if (!this.ready() || !this.data.editor || this.data.conflict || (!this.id && this.data.uncertain)) return;
    const f = this.data.form;
    const name = (this.kind === 'notice' ? f.title : f.name).trim();
    if (!name || name.length > 200 || (this.kind === 'notice' && !f.content.trim())) { this.setData({ actionError: this.kind === 'notice' ? '请填写标题和须知内容' : '请填写名称（最多 200 字）' }); return; }
    const payload = this.kind === 'notice' ? { title: name, content: f.content.trim() } : { name, introduction: f.introduction.trim(), ...(this.kind === 'opponent' ? { playerSummary: f.playerSummary.trim() } : {}) };
    payload.status = f.status;
    if (this.kind !== 'notice' && this._imageData !== undefined) payload.logo = this._imageData;
    if (this.id) payload.revision = this.revision;
    const creating = !this.id;
    const guardKey = this._guardKey;
    // a.act protects lifecycle, identity and repeated clicks. The durable marker
    // blocks ambiguous POST retries across page reloads without storing user data.
    const oldUncertain = this.data.uncertain;
    if (!creating) this.setData({ uncertain: false });
    await a.act(this, async () => {
      let dispatched = false, marker;
      try {
        if (creating) {
          if (wx.getStorageSync(guardKey)) throw Object.assign(Error('请先核对上次新增结果'), { createGuardPending: true });
          marker = Date.now() + '-' + Math.random().toString(36).slice(2);
          wx.setStorageSync(guardKey, marker);
          if (wx.getStorageSync(guardKey) !== marker) throw Error('无法保存核对记录，未发送请求');
        }
        dispatched = true;
        if (creating) inFlight.add(guardKey);
        const result = await s.api.request(this.config.path + (this.id ? '/' + encodeURIComponent(this.id) : ''), creating ? 'POST' : 'PUT', payload);
        if (!result?.id) throw Error('保存结果未确认，请返回列表核对');
        if (creating && wx.getStorageSync(guardKey) === marker) { wx.removeStorageSync(guardKey); if (wx.getStorageSync(guardKey)) throw Error('保存成功，但核对提醒未清除，请返回列表'); }
        return result;
      } catch (error) {
        const code = error.status || error.statusCode;
        if (!dispatched) error.createNotDispatched = true;
        if (creating && dispatched && code >= 400 && code < 500 && !error.staleSession && wx.getStorageSync(guardKey) === marker) wx.removeStorageSync(guardKey);
        throw error;
      } finally { if (creating && dispatched) inFlight.delete(guardKey); }
    }, async result => {
      this.id = result.id; this.revision = result.revision;
      this.setData({ editing: true, uncertain: false });
      if (this._returnToOpener && result.status === 'active') {
        this.getOpenerEventChannel?.().emit('saved', result);
        wx.navigateBack();
      } else { this.setData({ editor: false, inline: false }); this._adminRefresh = true; }
    }, creating);
    if (!creating && oldUncertain) this.setData({ uncertain: true });
    if (!this._hidden && !this._disposed && this._ownerToken === s.api.getSession()?.token && !this.data.editor && !this.data.busy) await this.refresh();
  },
  archive() {
    if (!this.ready() || !this.id || this.data.conflict) return;
    const status = this.data.form.status === 'active' ? 'inactive' : 'active';
    ui.showModal(this, { title: status === 'inactive' ? '停用记录' : '恢复记录', content: status === 'inactive' ? '停用后不再出现在比赛可选列表中，历史比赛保持不变。' : '恢复后可在比赛中选择。', success: r => { if (r.confirm && this.ready()) { this.setData({ 'form.status': status }); this.save(); } } });
  },
});
