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
      socket.emit('add tweet', childSnapshot.val());
    });
  });
});

geojson_ref.on('child_added', function(childSnapshot) {
  io.emit('add tweet', childSnapshot.val());
});

geojson_ref.on('child_removed', function(oldChildSnapshot) {
  io.emit('remove tweet', oldChildSnapshot.val());
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
      var tweet_id = tweet.id_str;
      last_id_ref.once("value", function(dataSnapshot) {
	  if(dataSnapshot.val() < tweet_id) {
	    last_id_ref.set(tweet_id);
	  }
      });
      //https://dev.twitter.com/web/javascript/loading
      twitter_client.get('statuses/oembed', {id: tweet.id_str, omit_script: true}, function(error, oembed, response) {
        var geojson = {
          type: 'Feature',
          geometry: {
            type: "Point",
            coordinates: []
          },
          properties: {
            description: oembed.html,
            profile_image_url: tweet.user.profile_image_url,
            twitter_handle: tweet.user.screen_name,
            tweet_id: tweet_id
          }
        };
	var current_geojson_ref = geojson_ref.push(geojson);
        var zipcode = 'N/A';
        var coords = [];
	tweet.entities.hashtags.forEach(function(hashtag) {
          var match = /^[a-zA-Z]{2}(\d{5})(-\d{4}$)?/.exec(hashtag.text); //matches 2 alpha followed by 5 digits then optionally '-' followed by 4 digits
	  if(match != null) { //hashtag appears to be zipcode, either ZIP or ZIP+4
            if(match[2] != undefined) { //ZIP+4
              zipcode = match[1]+ match[2];
            } else { //ZIP
              zipcode = match[1];
            }
	    mapbox_client.geocodeForward(zipcode, function(err, res) {
	      if(res.features.length > 0) {
		coords = res.features[0].geometry.coordinates;
	      } else {
	        coords = ['-77.0364', '38.8951'];
              }
              current_geojson_ref.child('geometry').update({coordinates: coords});
	    });
	  } else {
            //hashtag of only digits won't be recognized to Twitter, so text is searched
            var match = /#(\d{5})(?:(-\d{4})\s)?/g.exec(tweet.text); //matches # then 5 digits then optionally '-' followed by 4 digits
	    if(match != null) { //hashtag appears to be zipcode, either ZIP or ZIP+4
	      if(match[2] != undefined) { //ZIP+4
		zipcode = match[1]+ match[2];
	      } else { //ZIP
		zipcode = match[1];
	      }
	      mapbox_client.geocodeForward(zipcode, function(err, res) {
		if(res.features.length > 0) {
		  coords = res.features[0].geometry.coordinates;
		} else {
		  coords = ['-77.0364', '38.8951'];
		}
		current_geojson_ref.child('geometry').update({coordinates: coords});
	      });
	    } else {
	      coords = ['-77.0364', '38.8951'];
              current_geojson_ref.child('geometry').update({coordinates: coords});
            }
          }
	});
        var user_id = tweet.user.id_str;
        ref = new Firebase(firebase_app_url + 'link/' + user_id);
        var link = '';
        ref.set(link);
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
        res.redirect('/');
      }
    });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});
