from dify_plugin import DifyPluginEnv, Plugin

# A draft generation usually finishes in about a minute; higher tiers and busy
# queues take longer. The tools poll for up to 540 seconds, so give the
# request headroom above that.
plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=600))

if __name__ == "__main__":
    plugin.run()
