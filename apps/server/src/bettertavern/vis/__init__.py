"""vis：本机的可观测性查看器（`bettertavern vis`，网页在 apps/vis）。

只读：读日志文件（data_dir/logs/*.log）和数据库，拼出回合的时间线、请求列表和问题清单，给网页用。
只监听本机地址，不需要登录；能看到所有用户的故事和回合，所以不要在多人共用的服务器上对外开放。
业务代码不 import 这里（importlinter.ini 有约束）。设计见 docs/vis.md。
"""
