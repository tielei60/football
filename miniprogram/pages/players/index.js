const ui=require('../../utils/ui');
const s = require("../shared");
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
  data: {
    loading: true,
    error: "",
    players: [],
    visible: [],
    search: "",
    status: "active",
    statusInitialized: false,
    positionIndex: 0,
    selectedPosition: "",
    positions: ["全部位置"],
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  onHide(){ui.abort(this);return s.hide.apply(this,arguments);},
  imageError: s.imageError,
  openPlayer: s.openPlayer,
  refresh() {
    const owner = s.api.getSession()?.token;
    if (this._filterOwner !== owner) {
      this._filterOwner = owner;
      this.setData({status:"active",statusInitialized:false});
    }
    return s.load(this, async (session) => {
      const players = (await s.api.request("/players")).map(s.playerView);
      const status = this.data.statusInitialized ? this.data.status : !players.some(p=>p.status==="active"&&p.membershipConfirmed!==false)&&players.some(p=>p.membershipConfirmed===false) ? "unconfirmed" : "active";
      const positions = [
        "全部位置",
        ...new Set(players.flatMap((p) => p.positions || [])),
      ];
      const selectedPosition = positions.includes(this.data.selectedPosition)
        ? this.data.selectedPosition
        : "";
      return {
        status,
        statusInitialized: true,
        selectedPosition,
        positionIndex: selectedPosition
          ? positions.indexOf(selectedPosition)
          : 0,
        players,
        team: s.teamView(session.team),
        activeCount: players.filter(p => p.membershipConfirmed !== false && p.status === "active").length,
        inactiveCount: players.filter(p => p.membershipConfirmed !== false && p.status === "inactive").length,
        unconfirmedCount: players.filter(p => p.membershipConfirmed === false).length,
        positions,
        visible: this.filter(
          players,
          this.data.search,
          status,
          selectedPosition,
        ),
      };
    });
  },
  filter(rows, q, status, selectedPosition = this.data.selectedPosition) {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(
        (p) =>
          (status === "unconfirmed" ? p.membershipConfirmed === false : p.membershipConfirmed !== false && p.status === status) &&
          (!selectedPosition ||
            (p.positions || []).includes(selectedPosition)) &&
          (!needle ||
            p.name.toLowerCase().includes(needle) ||
            String(p.number ?? "").includes(needle)),
      )
      .sort(
        (a, b) =>
          (a.number ?? 100000) - (b.number ?? 100000) ||
          a.name.localeCompare(b.name),
      );
  },
  search(e) {
    const search = e.detail.value;
    this.setData({
      search,
      visible: this.filter(this.data.players, search, this.data.status),
    });
  },
  resetFilters() {
    if (this.data.loading) return;
    this.setData({search:"",selectedPosition:"",positionIndex:0,visible:this.filter(this.data.players,"",this.data.status,"")});
  },
  clearSearch() {
    if (this.data.loading) return;
    this.setData({ search: "", visible: this.filter(this.data.players, "", this.data.status) });
  },
  position(e) {
    const positionIndex = Number(e.detail.value);
    this.setData({
      positionIndex,
      selectedPosition: positionIndex
        ? this.data.positions[positionIndex] || ""
        : "",
    });
    this.setData({
      visible: this.filter(
        this.data.players,
        this.data.search,
        this.data.status,
      ),
    });
  },
  changeTab(e) {
    const status = e.currentTarget.dataset.status;
    if(this._filterOwner!==s.api.getSession()?.token||!["active","inactive","unconfirmed"].includes(status))return;
    this.setData({
      status,
      statusInitialized: true,
      visible: this.filter(this.data.players, this.data.search, status),
    });
  },
});
