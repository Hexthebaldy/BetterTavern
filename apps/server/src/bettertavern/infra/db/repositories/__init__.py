"""仓储：SQL 写在各模块的字符串里（方便评审和拿到 psql 里验证），用 SQLAlchemy 的 text() 执行。

约定：
- 所有按 ID 读写用户数据的语句都带 user_id 条件（直接或经 playthroughs 归属），越权访问拿不到行；
- JSONB 参数先 json.dumps 再 CAST(... AS jsonb)；
  读出的 JSONB 用 as_json() 兼容字符串和对象两种形态；
- UUID 以 str 进出；时间一律带时区。
"""
