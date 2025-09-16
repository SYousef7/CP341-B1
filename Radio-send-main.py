import radio
from microbit import *


radio.on()
radio.config(group=42)


while True:
p0 = 1 if pin0.is_touched() else 0
p1 = 1 if pin1.is_touched() else 0
s = microphone.sound_level()
data = str(p0) + "," + str(p1) + "," + str(s)
radio.send(data)