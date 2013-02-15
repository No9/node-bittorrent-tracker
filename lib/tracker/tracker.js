
function now() {
	return Math.floor(new Date().getTime()/1000);
}

const EVENT_NONE = 0;
const EVENT_COMPLETED = 1;
const EVENT_STARTED = 2;
const EVENT_STOPPED = 3;

function event(e) {
	switch (e) {
		case "completed":
			return EVENT_COMPLETED;
		case "started":
			return EVENT_STARTED;
		case "stopped":
			return EVENT_STOPPED;
	}

	return EVENT_NONE;
}


const PEERSTATE_SEEDER = 0;
const PEERSTATE_LEECHER = 1;

const PEER_COMPACT_SIZE = 6;

const ANNOUNCE_INTERVAL = 30;

function Peer(peer_id, ip, port, left) {
	if (!(this instanceof Peer))
		return new Peer(peer_id, ip, port, left);

	this.peer_id = peer_id;

	this.ip = ip;
	this.port = port;

	this.compact = this._compact(ip, port)

	this.state = (left > 0) ? PEERSTATE_LEECHER : PEERSTATE_SEEDER;

	this.touch();
}

Peer.prototype = {
	touch: function() {
		this.lastAction = now();
	},
	timedOut: function(n) {
		return n - this.lastAction > ANNOUNCE_INTERVAL * 2;
	},
	_compact: function(ip, port) {
		var b = new Buffer(PEER_COMPACT_SIZE);

		var parts = ip.split(".");
		if (parts.length != 4)
			throw 1

		for (var i = 0; i < 4; i++)
			b[i] = parseInt(parts[i]);

		b[4] = (port >> 8) & 0xff;
		b[5] = port & 0xff;

		return b;
	}
}

function File() {
	if (!(this instanceof File))
		return new File();

	this.peerList = [];
	this.peerDict = {};

	this.downloads = 0;
	this.seeders = 0;
	this.leechers = 0;

	this.lastCompact = now();
}

// random sampling using Floyd's algorithm
function floyd(list, m) {
	var n = list.length;
	if (m > n) return void console &&
		console.log('list length must be > sample');
	var sampleList = [];
	var usedIndexes = {};
	for (var i = n - m; i < n; i++) {
		var ri = ~~(Math.random() * i);
		if (usedIndexes[ri]) {
			sampleList.push(list[i]);
			usedIndexes[i] = true;
		}
		else {
			sampleList.push(list[ri]);
			usedIndexes[ri] = true;
		}
	}
	return sampleList;
}

File.prototype = {
	addPeer: function(peer, event) {
		// Check if it is time to compact the peer list
		var n = now();
		if (this.seeders + this.leechers < this.peerList.length / 2 && this.peerList.length > 10 || (n - this.lastCompact) > ANNOUNCE_INTERVAL * 2) {
			newPeerList = [];
			var i = 0;
			for (var p in this.peerDict) {
				if (!this.peerDict.hasOwnProperty(p))
					continue;

				var tmpPeer = this.peerList[this.peerDict[p]];

				// Check if the peer is still alive
				if (tmpPeer.timedOut(n)) {
					if (tmpPeer.state == PEERSTATE_LEECHER)
						this.leechers--;
					else
						this.seeders--;

					delete this.peerDict[p];
					continue;
				}

				newPeerList.push(tmpPeer);
				this.peerDict[p] = i++;
			}

			this.peerList = newPeerList;

			this.lastCompact = n;
		}

		if (event == EVENT_COMPLETED && peer.state == PEERSTATE_SEEDER)
			this.downloads++;

		// Check if the peer already exists
		if (this.peerDict.hasOwnProperty(peer.peer_id)) {
			var index = this.peerDict[peer.peer_id];
			var oldPeer = this.peerList[index];

			if (event == EVENT_STOPPED) {
				if (oldPeer.state === PEERSTATE_LEECHER)
					this.leechers--;
				else
					this.seeders--;

				delete this.peerList[index];
				delete this.peerDict[peer.peer_id];
			} else {
				// TODO: Should probably update compact in the old peer. So we
				// handle the case if the user switched IP or Port. But we
				// probably only want to do it if they differ
				// oldPeer.compact = peer.compact;

				if (oldPeer.state != peer.state) {
					if (peer.state === PEERSTATE_LEECHER) {
						this.leechers++;
						this.seeders--;
					} else {
						this.leechers--;
						this.seeders++;
					}

					oldPeer.state = peer.state;
				}
			}

			oldPeer.touch();

		} else if (event != EVENT_STOPPED) {
			this.peerDict[peer.peer_id] = this.peerList.length;
			this.peerList.push(peer);

			if (peer.state === PEERSTATE_LEECHER)
				this.leechers++;
			else
				this.seeders++;
		}
	},
	writePeers: function(b, count, peer_id) {
		// get <count> random peers
		var m = Math.min(count+1, this.peerList.length);
		var sampledPeers = floyd(this.peerList, m);

		var c = 0;
		for (var i = sampledPeers.length-1; i >= 0 && c < count; i--) {
			var p = sampledPeers[i];
			if (p != undefined && p.peer_id != peer_id) {
				p.compact.copy(b, c++ * PEER_COMPACT_SIZE);
			}
		}

		return c * PEER_COMPACT_SIZE;
	},
	getPeers: function(count, peer_id) {
		// get <count> random peers
		var m = Math.min(count+1, this.peerList.length);
		var sampledPeers = floyd(this.peerList, m);

		var res = [];
		var c = 0;
		for (var i = sampledPeers.length-1; i >= 0 && c < count; i--) {
			var p = sampledPeers[i];
			if (p != undefined && p.peer_id != peer_id) {
				res.push({ peer_id:p.peer_id, ip:p.ip, port:p.port });
				c++;
			}
		}

		return res;
	}
}

function Tracker() {
	if (!(this instanceof Tracker))
		return new Tracker();

	this.files = {};
}

Tracker.prototype = {
	getFile: function(infoHash) {
		if (this.files.hasOwnProperty(infoHash))
			return this.files[infoHash];

		return this.addFile(infoHash);
	},
	addFile: function(infoHash) {
		return (this.files[infoHash] = new File());
	}
}

exports.PEER_COMPACT_SIZE = PEER_COMPACT_SIZE
exports.ANNOUNCE_INTERVAL = ANNOUNCE_INTERVAL;

exports.event = event;
exports.Peer = Peer;
exports.Tracker = Tracker;
