"""Business logic shared by the HTTP API and the AI chat flow.

Both the REST routers and the assistant call these functions — trade and watchlist
rules live here exactly once and are never re-implemented at a call site.
"""
