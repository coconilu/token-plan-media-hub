# MCP Server

计划中的共同 Agent 工具层。MCP 工具只接受 provider-neutral 参数，并返回 job/artifact ID。

Key 通过本地 credential broker 解析，绝不出现在 MCP 配置和工具返回值中。

