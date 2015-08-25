#! /usr/bin/env node
var cli = require("cli");
var fs = require("graceful-fs");
var Promise = require("bluebird");
var async = require("async");
var PDFDocument = require("pdfkit");
var sizeOf = require('image-size');
var request = require("request");
var requestAsync = Promise.promisify(require("request"));
Promise.promisifyAll(request);
Promise.promisifyAll(async);
Promise.promisifyAll(fs);

var headers = {
	'User-Agent': 'MangaWeb'
};
var cliProgress = 0;
var jpgsLength = 0;

cli.parse({
	save: ["s", "set the save location for your manga"],
	reverse: ["r", "generate the PDF in reverse (you will need to read the PDF in reverse order, starting from the last page)"],
	path: ["p", "pick a file path with a list of manga to download"]
});

if (fs.readFileSync(__dirname + "/savelocation").length < 1){
	cli.fatal("Please set a save location with mangasave /directory/path for example: $ mangasave ~/Downloads");
}

var deleteFolderRecursive = function(path) {
  if( fs.existsSync(path) ) {
      fs.readdirSync(path).forEach(function(file) {
        var curPath = path + "/" + file;
          if(fs.statSync(curPath).isDirectory()) { // recurse
              deleteFolderRecursive(curPath);
          } else { // delete file
              fs.unlinkSync(curPath);
          }
      });
      fs.rmdirSync(path);
    }
};

var leftovers = fs.readdirSync(__dirname + "/manga");
for (var i = 0; i < leftovers.length; i++) {
	try {
		deleteFolderRecursive(__dirname + "/manga/" + leftovers[i]);
	} catch(e) {
	}
}

var sortJpgs = function(a, b) {
	var valA = parseInt(a.match(/\/(\d+)\.jpg/)[1]);
	var valB = parseInt(b.match(/\/(\d+)\.jpg/)[1]);
	return valA - valB;
};

var downloadImage = function(imgObj, cb) {
	return new Promise(function(resolve, reject) {
		var link = imgObj.link;
		var path = imgObj.path;
		var imgName = link.match(/\d+\.jpg/)[0];
		var req = request({url: link, headers: headers});
		req.pipe(fs.createWriteStream(path));
		req.on("end", function() {
			cli.progress(++cliProgress / jpgsLength);
			cb();
			resolve();
		});
	});
};

var getLinks = function(dirUrl) {
	return requestAsync({url: dirUrl, headers: headers})
	.then(function(res) {
		var links = res[0].body.match(/href="\/?\d+(\/|\.jpg)"/g);
		links = links.map(function(href) {
			href = dirUrl + "/" + href.match(/\d+(\/|\.jpg)/)[0];
			if (href[href.length - 1] === "/") {
				href = href.slice(0, href.length - 1);
			}
			return href;
		});
		return links;
	});
};

var convertName = function(name) {
	if (typeof(name) === "string") {
		var newName = name.toLowerCase().replace(/\s/g, "-");
		return newName;
	}
};

var getMangaUrl = function(name) {
	return requestAsync({url: "http://mangapark.me/manga/" + name, headers: headers})
	.then(function(res) {
		try {
			var id = res[0].body.match(/\_manga\_id\s*\=\s*'(\d+)'/)[1];
			return "http://2.p.mpcdn.net/" + id;
		} catch(e) {
			cli.fatal("Could not find this manga");
		}
	});
};

var getManga = function(name, callback) {
	console.log("searching");
	var mangaPdf = new PDFDocument();
	var mangaDirPath;
	var mangaQueue = async.queue(downloadImage, 6);
	var jpgLinks = {};
	var mangaUrl;
	var chapters;

	mangaQueue.drain = function() {
		cli.ok("Done downloading manga");
		console.log("Generating PDF");
		cliProgress = 0;
		cli.progress(cliProgress / jpgsLength);
		if (options.reverse) {
			for (var i = chapters.length - 1; i >= 0 ; i--) {
				for (var j = jpgLinks[i].length - 1; j >= 0; j--) {
					var dimensions = sizeOf(jpgLinks[i][j].path);
					mangaPdf
					.addPage({
						size: [dimensions.width, dimensions.height],
						margin: 0
						})
					.image(jpgLinks[i][j].path);
					cli.progress(++cliProgress / jpgsLength);
				}
			}
		} else {
			for (var i = 0; i < chapters.length; i++) {
				for (var j = 0; j < jpgLinks[i].length; j++) {
					var dimensions = sizeOf(jpgLinks[i][j].path);
					mangaPdf
					.addPage({
						size: [dimensions.width, dimensions.height],
						margin: 0
						})
					.image(jpgLinks[i][j].path);
					cli.progress(++cliProgress / jpgsLength);
				}
			}
		}
		mangaPdf.end();
		cli.ok("Done creating pdf");
		deleteFolderRecursive(mangaDirPath);
		if (callback) callback(fs.readFileSync(__dirname + "/savelocation") + "/" + name + ".pdf");
	};
	getMangaUrl(name)
	.then(function(url) {
		mangaUrl = url;
		mangaDirPath = __dirname + "/manga/" + name;
		try {
			return fs.mkdirAsync(mangaDirPath);
		} catch(e) {
			return;
		}
	})
	.then(function() {
		mangaPdf.pipe(fs.createWriteStream(fs.readFileSync(__dirname + "/savelocation") + "/" +name + ".pdf"));
		mangaPdf.moveDown(25);
		mangaPdf.text(name.replace("-", " "), {
			align: "center"
		});
		return getLinks(mangaUrl);
	})
	.then(function(links) {
		chapters = links;
		return async.mapAsync(links, function(link, cb) {
			var chapterNum = links.indexOf(link);
			jpgLinks[chapterNum] = [];
			var chapterPath = mangaDirPath + "/" + chapterNum;
			var mkdir;
			try {
				mkdir = fs.mkdirAsync(chapterPath);
			} catch(e) {
				mkdir = fs.mkdirAsync(chapterPath);
			}
			mkdir.then(function() {
				return getLinks(link);
			})
			.then(function(jpgs) {
				jpgsLength += jpgs.length;
				var currentJpgPaths = [];
				for (var i = 0; i < jpgs.length; i++) {
					currentJpgPaths.push(chapterPath + "/" + jpgs[i].match(/\d+\.jpg$/)[0]);
				}
				currentJpgPaths.sort(sortJpgs);
				jpgs.sort(sortJpgs);
				for (i = 0; i < jpgs.length; i++) {
					jpgLinks[chapterNum].push({path: currentJpgPaths[i], link: jpgs[i]});
				}
				cb();
			});
		});
	})
	.then(function() {
		console.log("Downloading Manga");
		cli.progress(cliProgress / jpgsLength);
		for (var i = 0; i < chapters.length; i++) {
			for (var j = 0; j < jpgLinks[i].length; j++) {
				mangaQueue.push(jpgLinks[i][j], function() {});
			}
		}
	});
};
var options = cli.parse();
var args = cli.args;

if (options.save) {
	location = args.join(" ");
	if (location) {
		if (fs.statSync(location).isDirectory()) {
			fs.writeFileSync(__dirname + "/savelocation", location);
		} else {
			console.log("That is not a valid directory, use pwd to get your current directory path");
		}
	} else {
		console.log("Please supply a save location");
	}
} else if(options.path){
	var mangas = fs.readFileSync(args.join(" ")).toString().match(/.*\n/g).slice(0,-1);
	var allMangaQueue = async.queue(getManga, 1);
	mangas.map(function(manga) {
		allMangaQueue.push(manga, function() {});
	});
	allMangaQueue.drain(function() {
		console.log("All done");
	});

} else {
	getManga(args.join("-"), function(path) {
		console.log(path);
	});
}