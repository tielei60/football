const logic = require('../../pages/wechat-invites/logic');
const { data, onLoad, onShow, onHide, onUnload, ...methods } = logic;
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { player: { type: String, value: '' } },
  data: { ...data, sheetOpen: false },
  pageLifetimes: { hide() { this.closeSheet(); } },
  lifetimes: { detached() { this.closeSheet(); this._disposed = true; } },
  methods: {
    ...methods,
    async open() {
      if (this.data.sheetOpen || !this.properties.player) return;
      this.id = this.properties.player;
      this._hidden = false; this._disposed = false;
      this.setData({ sheetOpen: true });
      await this.refresh();
      if (!this.data.sheetOpen || !this.ready() || this.data.archived || this.data.unconfirmed || this.data.binding?.bound || this.data.activeInvite?.status === 'claimed') return;
      await this.create();
    },
    closeSheet() {
      this.invalidate();
      this.setData({ sheetOpen: false });
    },
    closeCard() { this.closeSheet(); },
  },
});
