var sqlite3 = require('sqlite3').verbose();

exports.make = function() {
	var db;
	this.open = (path) => {
		return new Promise((resolve, reject) => {
			db = new sqlite3.Database(path, (err) => {
				if (err !== null) return reject(err);
				resolve();
			});
		});
	};
	this.run = (command) => {
		return new Promise((resolve, reject) => {
			db.run(command, (err) => {
				if (err !== null) return reject(err);
				resolve();
			});
		});
	};
	this.all = (command) => {
		return new Promise((resolve, reject) => {
			db.all(command, (err, rows) => {
				if (err !== null) return reject(err);
				resolve(rows);
			});
		});
	};
	this.close = () => new Promise((resolve, reject) => db.close());
	this.ready = () => db ? true : false;
	this.raw = () => db;

	return this;
};
