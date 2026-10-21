import json
from urllib.parse import urlsplit
from as_industries.integration import get_navigation_config
no_cache = 1

def get_context(context):
    url = urlsplit(get_navigation_config()["app_urls"]["shop"])
    context.shop_origin = json.dumps(url.scheme + "://" + url.netloc).replace("<", "\\u003c")
    context.no_cache = 1
