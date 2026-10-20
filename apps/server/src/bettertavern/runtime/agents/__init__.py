"""一个 agent 一个文件，agent 之间不互相 import。

每个文件里有这个 agent 的定义（`AgentSpec`），由 runtime/agent/loop.py 的执行循环运行，
runtime/runner.py 决定什么时候调哪个 agent。
"""
