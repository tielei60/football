module.exports=function(s){return s
.replace("{{membershipConfirmed===false?'状态未确认':status==='active'?'在队':'已归档'}}", "{{status==='active'?'在队':'已归档'}}")
.replace('<view aria-role="button" class="tab {{status===\'unconfirmed\'?\'active\':\'\'}}" data-status="unconfirmed" bindtap="changeTab">待确认</view>','')
.replace('<view aria-role="button" class="tab {{status===\'unconfirmed\'?\'active\':\'\'}}" data-status="unconfirmed" bindtap="status">待确认</view>','')
.replace('<view wx:if="{{unconfirmedCount}}" class="hint">另有 {{unconfirmedCount}} 位成员状态未确认</view>','')
.replace('位在队队员</text','位队员</text')
.replace('{{player.membershipLabel}}',"{{player.status==='active'?'在队':'已归档'}}")
.replace('<view class="field"><text class="field-label">成员状态</text><business-picker title="成员状态" bind:pickeropen="openBusinessPicker" range="{{membershipOptions}}" value="{{membershipIndex}}" bindchange="membership" disabled="{{loading||busy||conflict||uncertain}}"><view class="picker"><text class="picker-value">{{membershipOptions[membershipIndex]}}</text></view></business-picker></view>','')
.replace('wx:if="{{id&&membershipConfirmed}}" class="danger ui-button ui-block"','wx:if="{{id}}" class="danger ui-button ui-block"');};
