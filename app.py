from flask import Flask, render_template #importing module
app = Flask (__name__)#create n instance and say it

@app.route ('/') # going to the mail url of the web page

def home():
   return render_template('index.html') # bring up
   #return ("Hello World")

if __name__ == '__main__':
    app.run()