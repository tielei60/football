# 前后端开发服务管理；在项目根目录执行 make help 查看中文说明。
.DEFAULT_GOAL := help
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
FRONTEND_PORT ?= 15173
BACKEND_PORT ?= 13001
export FRONTEND_PORT BACKEND_PORT

.PHONY: help start stop restart status logs start-frontend start-backend stop-frontend stop-backend restart-frontend restart-backend status-frontend status-backend logs-frontend logs-backend test-services

help:
	@echo '前后端开发服务管理（后台运行，默认仅本机访问）'
	@echo '  make start / stop / restart    启动 / 停止 / 重启前后端'
	@echo '  make status                   查看前后端运行状态'
	@echo '  make logs                     查看前后端最近 50 行日志'
	@echo '  make start-frontend           单独启动前端'
	@echo '  make start-backend            单独启动后端'
	@echo '  make <操作>-frontend          单独管理前端，操作同上'
	@echo '  make <操作>-backend           单独管理后端，操作同上'
	@echo '  make test-services            运行服务管理集成测试'
	@echo '  默认端口：前端 15173，后端 13001'
	@echo '  自定义端口：make start FRONTEND_PORT=15174 BACKEND_PORT=13002'
	@echo '  日志和进程记录：app/.run/；实时日志：tail -f app/.run/*.log'
	@echo '  首次启动前：cd app && yarn install；需要 Node.js 22.13 或更高版本'

start stop restart status logs:
	@node "$(ROOT)app/scripts/services.mjs" $@ all

start-frontend start-backend stop-frontend stop-backend restart-frontend restart-backend status-frontend status-backend logs-frontend logs-backend:
	@node "$(ROOT)app/scripts/services.mjs" $(word 1,$(subst -, ,$@)) $(word 2,$(subst -, ,$@))

test-services:
	@cd "$(ROOT)app" && node --test scripts/services.test.mjs
