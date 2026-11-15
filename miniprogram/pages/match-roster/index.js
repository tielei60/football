const ui=require('../../utils/ui');
const s = require('../shared');
const selections = [{ label: '未确定', value: 'unknown' }, { label: '首发', value: 'starter' }, { label: '替补', value: 'bench' }];
const appearances = [{ label: '待确认', value: null }, { label: '已出场', value: true }, { label: '未出场', value: false }];
const standardPositions = ['', 'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
const nullable = value => value == null ? '' : String(value);
function rowView(row, player, preview) {
  const identity = row.playerSnapshot || preview || player;
  const positionValues = [...new Set([...standardPositions, ...(player?.positions || []), row.position || ''])];
  return { playerId: row.playerId, name: identity?.name || '历史成员', number: identity?.number ?? '—', historical: !!row.playerSnapshot, migration: row.snapshotSource === 'migration', selectionIndex: Math.max(0, selections.findIndex(x => x.value === row.selection)), appearanceIndex: row.appeared === true ? 1 : row.appeared === false ? 2 : 0, positionValues, positionLabels: positionValues.map(x => x || '未设置'), positionIndex: positionValues.indexOf(row.position || ''), goals: nullable(row.goals), assists: nullable(row.assists) };
}
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
  data: { loading: true, error: '', busy: false, conflict: false, actionError: '', opponent: '', revision: null, rows: [], candidates: [], candidateIndex: 0, selections, appearances },
  onLoad(query) { this.id = query.id; this._hidden = false; this._firstShow = true; this.refresh(); },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  onHide() {ui.abort(this); this._hidden = true; this._epoch = (this._epoch || 0) + 1; this.setData({ loading: true }); },
  async onShow() {
    this._hidden = false;
    if (this._firstShow) { this._firstShow = false; return; }
    if (!this._loaded) { if (this._started) this.refresh(); return; }
    const epoch = this._epoch;
    if (this.data.busy && this._saveAttempt && this._owner === s.api.getSession()?.token)
      this._saveResume = { attempt: this._saveAttempt, epoch };
    try {
      const account = await s.api.ensureSession();
      if (epoch !== this._epoch || this._disposed || this._hidden) return;
      if (account.user.role !== 'admin' || s.api.getSession()?.token !== this._owner) {
        this.setData({ rows: [], candidates: [], error: '登录身份已变化，请重新打开比赛名单。', loading: false }); return;
      }
      if (this._refreshOnShow) { this._refreshOnShow = false; return this.refresh(); }
      this.setData({ loading: false, busy: this.data.busy, actionError: this.data.actionError, conflict: this.data.conflict });
    } catch (error) { if (epoch === this._epoch && !this._hidden && !this._disposed) { this.setData({ loading: false }); s.fail(this, error); } }
  },
  refresh() {
    this._started = true;
    return s.load(this, async account => {
      if (account.user.role !== 'admin') throw new Error('仅管理员可以维护比赛名单');
      const owner = s.api.getSession()?.token, epoch = this._epoch;
      const current = () => !this._disposed && !this._hidden && epoch === this._epoch && owner === s.api.getSession()?.token;
      const check = () => { if (!current()) throw Object.assign(new Error('已忽略旧页面结果'), { staleSession: true }); };
      const [match, players] = await Promise.all([s.api.request('/matches/' + encodeURIComponent(this.id)), s.api.request('/players')]);
      check();
      // 仅关联赛季才读取身份预览；失败沿用原错误/重试，不猜当前资料。
      const seasonal = match.seasonId == null ? null : await s.api.request('/seasons/' + encodeURIComponent(match.seasonId) + '/roster');
      check();
      const preview = new Map((seasonal?.roster || []).map(p => [p.playerId, p]));
      const currentPlayers = players.map(p => ({ id: p.id, name: p.name, number: p.number, status: p.status, positions: p.positions }));
      const originalRows = new Map(match.roster.map(row => [row.playerId, row]));
      const rows = match.roster.map(row => rowView(row, currentPlayers.find(p => p.id === row.playerId), preview.get(row.playerId)));
      this._players = currentPlayers; this._previewIdentity = preview;
      this._owner = owner; this._originalRows = originalRows;
      return { rows, candidates: this.candidates(rows), candidateIndex: 0, opponent: match.opponent, revision: match.revision, actionError: '', conflict: false };
    }).then(() => { this._loaded = this.data.revision !== null; });
  },
  candidates(rows) { const ids = new Set(rows.map(r => r.playerId)); return (this._players || []).filter(p => p.status === 'active' && !ids.has(p.id)).map(p => { const identity = this._originalRows?.get(p.id)?.playerSnapshot || this._previewIdentity?.get(p.id) || p; return { id: p.id, label: `${identity.number ?? '—'} · ${identity.name}` }; }); },
  editable() { return !this.data.busy && !this.data.loading && !this.data.error && !this.data.conflict && !this._disposed && !this._hidden && this._owner === s.api.getSession()?.token; },
  choosePlayer(e) { if (this.editable()) this.setData({ candidateIndex: Number(e.detail.value) }); },
  add() {
    if (!this.editable()) return;
    const candidate = this.data.candidates[this.data.candidateIndex]; if (!candidate) return;
    const player = this._players.find(p => p.id === candidate.id);
    const rows = [...this.data.rows, rowView({ playerId: player.id, selection: 'unknown', appeared: null, playerSnapshot: this._originalRows?.get(player.id)?.playerSnapshot, snapshotSource: this._originalRows?.get(player.id)?.snapshotSource }, player, this._previewIdentity?.get(player.id))];
    s.safeSetData(this, { rows, candidates: this.candidates(rows), candidateIndex: 0, actionError: '' });
  },
  remove(e) {
    if (!this.editable()) return;
    const id = e.currentTarget.dataset.id;
    ui.showModal(this,{ title: '移除比赛名单', content: '保存后此人不再列入本场名单；重新加入已保存移除的成员，会重新留存身份资料。', success: result => {
      if (!result.confirm || !this.editable()) return;
      const rows = this.data.rows.filter(r => r.playerId !== id);
      s.safeSetData(this, { rows, candidates: this.candidates(rows), candidateIndex: 0 });
    } });
  },
  pick(e) {
    if (!this.editable()) return;
    const { id, field } = e.currentTarget.dataset;
    if (!['selectionIndex', 'appearanceIndex', 'positionIndex'].includes(field)) return;
    const index = this.data.rows.findIndex(r => r.playerId === id), value = Number(e.detail.value); if (index < 0 || !Number.isInteger(value)) return;
    const row = this.data.rows[index], max = field === 'positionIndex' ? row.positionValues.length : 3;
    if (value < 0 || value >= max) return;
    const apply = () => { if (!this.editable()) return; const index = this.data.rows.findIndex(r => r.playerId === id); if (index < 0) return; const patch = { [`rows[${index}].${field}`]: value }; if (field === 'appearanceIndex' && value !== 1) { patch[`rows[${index}].goals`] = ''; patch[`rows[${index}].assists`] = ''; } this.setData(patch); };
    if (field === 'appearanceIndex' && value !== 1 && (row.goals !== '' || row.assists !== '')) ui.showModal(this,{ title: '清除个人数据', content: '只有已确认出场的球员可以登记进球和助攻。更改后将清空这两项，是否继续？', success: r => { if (r.confirm) apply(); } }); else apply();
  },
  input(e) {
    if (!this.editable()) return;
    const { id, field } = e.currentTarget.dataset; if (!['goals', 'assists'].includes(field)) return;
    const index = this.data.rows.findIndex(r => r.playerId === id);
    if (index < 0 || this.data.rows[index].appearanceIndex !== 1) return;
    this.setData({ [`rows[${index}].${field}`]: e.detail.value });
  },
  reload() { if (this.data.busy) return; ui.showModal(this,{ title: '重新载入名单', content: '将丢弃尚未保存的编辑，读取比赛最新版本。', success: r => { if (r.confirm && !this._disposed && !this._hidden) this.refresh(); } }); },
  async save() {
    if (!this.editable()) return;
    let roster;
    try {
      roster = this.data.rows.map(row => {
        const appeared = appearances[row.appearanceIndex].value;
        const count = field => { const value = row[field]; if (value === '') return null; if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('进球和助攻须为非负整数，未知请留空'); return Number(value); };
        return { playerId: row.playerId, position: row.positionValues[row.positionIndex], selection: selections[row.selectionIndex].value, appeared, goals: appeared === true ? count('goals') : null, assists: appeared === true ? count('assists') : null };
      });
    } catch (error) { this.setData({ actionError: error.message }); return; }
    const owner = this._owner, epoch = this._epoch, attempt = this._saveAttempt = {};
    const owned = () => !this._disposed && this._saveAttempt === attempt && owner === this._owner && owner === s.api.getSession()?.token;
    const resumed = () => this._saveResume?.attempt === attempt && this._saveResume.epoch === this._epoch;
    const current = () => owned() && (epoch === this._epoch || resumed()) && !this._hidden;
    this.setData({ busy: true, actionError: '' });
    try {
      const match = await s.api.request('/matches/' + encodeURIComponent(this.id) + '/roster', 'PUT', { revision: this.data.revision, roster });
      if (!owned()) return;
      if (this._hidden) { this._refreshOnShow = true; return; }
      if (!current()) return;
      // 返回页面时仍在等同一次保存：读取服务器结果，不让旧响应覆盖后续刷新。
      if (epoch !== this._epoch) { this.setData({ busy: false }); return this.refresh(); }
      this._originalRows = new Map(match.roster.map(row => [row.playerId, row]));
      const rows = match.roster.map(row => rowView(row, this._players.find(p => p.id === row.playerId), this._previewIdentity?.get(row.playerId)));
      s.safeSetData(this, { rows, candidates: this.candidates(rows), candidateIndex: 0, revision: match.revision });
      ui.showToast(this,{ title: '名单已保存', icon: 'success' });
    } catch (error) {
      if (!this._disposed && !this._hidden && this._saveAttempt === attempt &&
          (epoch === this._epoch || resumed()) && error.staleSession !== true &&
          (error.status || error.statusCode) === 401 && !s.api.getSession()) {
        this.setData({ busy: false }); s.fail(this, error); return;
      }
      if (!owned() || (!this._hidden && epoch !== this._epoch && !resumed())) return;
      const conflict = error.status === 409;
      const patch = { conflict, actionError: conflict ? '比赛已被修改，输入已保留。请核对后重新载入，不能直接覆盖。' : error.message || '保存未完成，输入已保留。' };
      if (this._hidden) Object.assign(this.data, patch); else { this.setData(patch); if (error.status === 401) s.fail(this, error); }
    } finally { if (owned() && (this._hidden || epoch === this._epoch || resumed())) { this.data.busy = false; if (!this._hidden) this.setData({ busy: false }); } }
  },
});
