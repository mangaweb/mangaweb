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
const chrome = require('chrome-cookies-secure');
Promise.promisify(chrome.getCookies);
const puppeteer = require('puppeteer');
const url = "https://mangapark.net";


var headers = {
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36',
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

var ajax_query = function(query) {
	return requestAsync({url: "http://mangapark.net/ajax-autocomplete.js?q=" + query, headers: headers})
	.then(function(res) {
		try {
			console.log(res)
			var id = res[0].body.match(/"(\d+)\\\/"/)[1];
			return "http://file-image.mpcdn.net//" + id;
		} catch(e) {
			return "not found";
			// cli.fatal("Could not find this manga");
		}
	});
}

var getMangaUrl = function(name) {
	return requestAsync({url: "http://webcache.googleusercontent.com/search?q=cache:http://mangapark.me/manga/" + name, headers: headers})
	.then(function(res) {
		try {
			console.log(res)
			var id = res[0].body.match(/\_manga\_id\s*\=\s*'(\d+)'/)[1];
			return "http://file-image.mpcdn.net//" + id;
		} catch(e) {
			console.log(e);
			cli.fatal("Could not find this manga");
			return;
		}
	});
};

var getManga = async function(name, callback) {
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
	console.log("opening browser");
	const browser = await puppeteer.launch({ 
		headless: false
	});
	const page = await browser.newPage();
 
	await page.goto("http://mangapark.net/manga/" + name);
	while(!page.isClosed()) {
		await page.waitFor(2000);
		try {
			const id = await page.evaluate("_manga_id");
			mangaUrl = "http://file-image.mpcdn.net//" + id;
			console.log("id found!");
			page.close();
		} catch(e) {
			console.log("searching for id")
		}
		// ajax_query(name).then((foundUrl) => {
		// 	if (foundUrl !== "not found") {
		// 		mangaUrl = foundUrl;
		// 		page.close();
		// 	}
		// });
		// if (page.body) {
		// 	console.log(page.body);
		// 	if (page.body.match(/"(\d+)\\\/"/)) {
		// 		id = page.body.match(/"(\d+)\\\/"/)[1];
		// 		page.close();
		// 	}
		// }
	};
	
	console.log(mangaUrl);
	// browser.close();
	// chrome.getCookies(url, function(err, cookies) {
	// 	console.log(cookies);
	// 	headers.cookie = cookies;
	// 	ajax_query(name)
	// 	.then(function(url) {
			// mangaUrl = "http://file-image.mpcdn.net//" + id;
			mangaDirPath = __dirname + "/manga/" + name;
			// try {
				return fs.mkdirAsync(mangaDirPath)
			// } catch(e) {
			// 	return;
			// }
		// })
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
	// });
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