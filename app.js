var config = require('./config');
var path = require('path');
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var passport = require('passport');
var Strategy = require('passport-twitter').Strategy;
app.use(require('express-session')({ secret: config.session_secret_key, resave: true, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

passport.use(new Strategy({
    consumerKey: config.twitter.consumer_key,
    consumerSecret: config.twitter.consumer_secret,
    callbackURL: config.twitter.callback_url
  },
  function(token, tokenSecret, profile, cb) {
    return cb(null, profile);
}));

var default_link_url = config.default_link_url;

var Firebase = require('firebase');
var firebase_app_url = config.firebase.app_url;
var geojson_ref = new Firebase(firebase_app_url + 'geojson');
var last_id_ref = new Firebase(firebase_app_url + 'last_id');
var link_ref = new Firebase(firebase_app_url + 'link');

var MapboxClient = require('mapbox');
var mapbox_client = new MapboxClient(config.mapbox.access_token);

var Twitter = require('twitter');
var twitter_client = new Twitter({
  consumer_key: config.twitter.consumer_key,
  consumer_secret: config.twitter.consumer_secret,
  access_token_key: config.access_token_key,
  access_token_secret: config.access_token_secret
});

io.on('connection', function(socket) {
  geojson_ref.once('value', function(dataSnapshot) {
    dataSnapshot.forEach(function(childSnapshot) {
      socket.emit('tweet', childSnapshot.val());
    });
  });
});

geojson_ref.on('child_added', function(dataSnapshot) {
  io.emit('tweet', dataSnapshot.val());
});

function get_tweets() {
//#MakerMap 
last_id_ref.once("value", function(dataSnapshot) {
  last_id = dataSnapshot.val();
  var search = {
    q: '#MakerMap -RT',
    count: 100
  }
  if(last_id > 0) {
    search.since_id = last_id;
  }
  twitter_client.get('search/tweets', search, function(error, data, response) {
    data.statuses.forEach(function(tweet) {
      var user_id = tweet.user.id_str;
      ref = new Firebase(firebase_app_url + 'link/' + user_id);
      ref.set(default_link_url);
      var tweet_id = tweet.id_str;
      last_id_ref.once("value", function(dataSnapshot) {
	  if(dataSnapshot.val() < tweet_id) {
	    last_id_ref.set(tweet_id);
	  }
      });
      //https://dev.twitter.com/web/javascript/loading
      twitter_client.get('statuses/oembed', {id: tweet.id_str, omit_script: true}, function(error, oembed, response) {
	geocoded = false;
	geojson = {}
	tweet.entities.hashtags.forEach(function(hashtag) {
	  if(/^\d{5}$/.test(hashtag.text)) { //hashtag appears to be zipcode
	    mapbox_client.geocodeForward(hashtag.text, function(err, res) {
	      if(res.features.length > 0) {
		geojson = {
		  type: 'Feature',
		  geometry: res.features[0].geometry,
		  properties: {
		    description: oembed.html,
                    profile_image_url: tweet.user.profile_image_url,
		    hidden: false
		  }
		}
		geocoded = true;
		return;
	      }
	    });
	  }
	});
	if(geocoded == false) {
	  geojson = { //default if unable to resolve a location
	    type: 'Feature',
	    geometry: {
	    type: "Point",
	      coordinates: [
		'-77.0364',
		'38.8951'
	      ]
	    },
	    properties: {
	      description: oembed.html,
              profile_image_url: tweet.user.profile_image_url,
	      hidden: false
	    }
	  };
	}
	geojson_ref.push(geojson);
      });
    });
  });
});
}

get_tweets();
setInterval(get_tweets, 10*1000);

app.get('/', function(req, res, next) {
  res.render('index');
});

app.get('/login',
  passport.authenticate('twitter'));

app.get('/login/return', 
  passport.authenticate('twitter', { failureRedirect: '/login' }),
  function(req, res) {
    res.redirect('/form');
});

app.get('/form',
  require('connect-ensure-login').ensureLoggedIn(),
  function(req, res){
    link_ref.child(req.user._json.id_str).once('value', function(dataSnapshot) {
      var link = dataSnapshot.val();
      if(link != null) {
        res.redirect(dataSnapshot.val());
      } else {
        res.redirect(default_link_url);
      }
    });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});
