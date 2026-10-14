type Annotation = {
    user?: string,
    id: string,
    // type?: Annotation,
    document: Document,
    body: string,
    attachmentUrls?: string[],
    access: Access,
    link?: Link[],
    timestamp: string

};

// type Annotation = "comment" | "attachment" | "link";

type Access = "public" | "private" | "anonymous";

type Link = {
    position: CommentBodyPosition,
    commentId?: string,
    documentId?: string
};

export type CommentBodyPosition={

}

type Document = {
    id: string,
    url: string
    uploader: User,
    properties: DocumentProperties,
    hash: string,
    fileType: string 
    // diff between defining in the type, and defining in the code when used eg could be a type with set values or just be a string, let the data send the filetype, but a filetype does have to be standardized

}

type User = {
    id: string,
    name?: string
}

type DocumentProperties = {
    author: string,
    title: string,
    subtitle?: string,
    type: DocumentMedium


}

type DocumentMedium = "essay" | "book" | "poem" | "shortFilm" | "film" | ""
// may need to pull from the library data

export type { Annotation, Access, Link }