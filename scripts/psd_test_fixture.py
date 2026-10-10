"""Deterministic nested PSD for browser integration tests, no model calls."""
import sys
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer, Group

psd=PSDImage.new('RGBA',(300,400))
PixelLayer.frompil(Image.new('RGBA',(220,280),'#c3536b'),psd,'Face bottom',top=70,left=40)
group=Group.new(psd,'Nested')
PixelLayer.frompil(Image.new('RGBA',(170,150),'#ead7b7'),group,'Hair middle',top=100,left=65)
PixelLayer.frompil(Image.new('RGBA',(120,90),'#618d97'),group,'Sleeve top',top=150,left=90)
hidden=PixelLayer.frompil(Image.new('RGBA',(90,40),'#664488'),psd,'Hidden',top=20,left=20)
hidden.visible=False
path=Path(sys.argv[1]);path.parent.mkdir(parents=True,exist_ok=True);psd.save(path)
