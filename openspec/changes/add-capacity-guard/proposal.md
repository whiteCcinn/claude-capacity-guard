# Claude capacity guard

Build a separate native Claude Code Mods plugin, following the module layout and configuration approach of claude-interaction-translator. Read subscription quota through the host, pause unfinished automation below a configurable remaining percentage, and continue the same conversation after every blocking window resets.

The first release targets interactive sessions that stay open. It must disclose native cached-data limits and headless process lifetime. It must not read OAuth credentials, estimate quota from token counts, or start real model requests in tests.
